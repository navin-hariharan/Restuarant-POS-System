//! Payment methods (Setup > Payment methods).

use super::records::{self, filled, Col, Row};
use crate::{
    activity,
    auth::AuthUser,
    db::RowExt,
    error::{AppError, AppResult, Errors},
    input::Input,
    query::Sql,
    settings::Settings,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{delete, get},
    Json, Router,
};
use serde_json::{json, Value};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/payment-methods", get(index).post(store))
        .route("/admin/payment-methods/{payment_method}", get(show).put(update).patch(update))
        .merge(
            Router::new()
                .route("/admin/payment-methods/{payment_method}", delete(destroy))
                .route_layer(axum::middleware::from_fn(crate::middleware::demo_mode)),
        )
}

const MANAGE: &str = "manage_payment_methods";

/// PaymentMethodResource
pub fn method_json(s: &Settings, r: &Row) -> Value {
    json!({
        "id": r.get("id"),
        "title": r.get("title"),
        "created_at": records::date(s, r, "created_at"),
        "updated_at": records::date(s, r, "updated_at"),
    })
}

async fn index(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let rows = Sql::new("SELECT * FROM payment_methods ORDER BY created_at DESC").fetch_all(&state.db).await?;
    let s = state.settings.get().await;
    Ok(Json(Value::Array(rows.iter().map(|r| method_json(&s, r)).collect())))
}

async fn validate(state: &AppState, input: &Input, ignore: Option<i64>) -> AppResult<Vec<Col>> {
    let mut e = Errors::default();
    let title = input.val("title");
    if !filled(Some(&title)) {
        e.add("title", tr!("The title field is required."));
    } else if records::taken(state, "payment_methods", "title", &title, ignore).await? {
        e.add("title", tr!("The title has already been taken."));
    }
    e.check()?;
    Ok(vec![Col::plain("title", title)])
}

async fn store(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let cols = validate(&state, &input, None).await?;
    let now = state.settings.get().await.now();
    let id = records::insert(&state.db, "payment_methods", &cols, now).await?;
    activity::log(&state, &user, &headers, &state.t("New payment method added successfully").await, None).await;
    Ok(Json(json!({ "message": state.t("Data saved successfully").await, "method": id })))
}

async fn show(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let row = records::find(&state, "payment_methods", &id).await?;
    let s = state.settings.get().await;
    Ok(Json(method_json(&s, &row)))
}

async fn update(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(id): Path<String>, input: Input) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let row = records::find(&state, "payment_methods", &id).await?;
    let cols = validate(&state, &input, Some(row.i64("id"))).await?;
    let now = state.settings.get().await.now();
    records::update(&state.db, "payment_methods", &row, &cols, now).await?;
    activity::log(&state, &user, &headers, &state.t("Payment method updated successfully").await, None).await;
    Ok(Json(json!({ "message": state.t("Data updated successfully").await, "method": row.i64("id") })))
}

async fn destroy(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let row = records::find(&state, "payment_methods", &id).await?;
    let id = row.i64("id");
    if records::count_where(&state, "sales", "payment_method_id", id).await? > 0 {
        return Err(AppError::unprocessable("Unable to remove payment method information is being used"));
    }
    sqlx::query("DELETE FROM payment_methods WHERE id = ?").bind(id).execute(&state.db).await?;
    activity::log(&state, &user, &headers, &state.t("Payment method removed successfully").await, None).await;
    Ok(Json(json!({ "message": state.t("Data removed successfully").await })))
}
