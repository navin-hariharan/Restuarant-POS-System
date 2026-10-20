//! Service (dining) tables (Setup > Service tables), each with its digital menu link.

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
    Router::new().route("/admin/service-tables", get(index).post(store)).route("/admin/service-tables/{service_table}", get(show)).merge(
        Router::new()
            .route("/admin/service-tables/{service_table}", delete(destroy).put(update).patch(update))
            .route_layer(axum::middleware::from_fn(crate::middleware::demo_mode)),
    )
}

const MANAGE: &str = "manage_service_tables";

/// ServiceTableResource
pub fn table_json(state: &AppState, s: &Settings, r: &Row) -> Value {
    let stamp = chrono::Utc::now().timestamp();
    json!({
        "id": r.get("id"),
        "title": r.get("title"),
        "digital_menu": state.asset_url(&format!("dm?t={}&stamp={stamp}", r.i64("id"))),
        "is_open": super::seating::row_is_open(s, r),
        "created_at": records::date(s, r, "created_at"),
        "updated_at": records::date(s, r, "updated_at"),
    })
}

async fn index(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let rows = Sql::new("SELECT * FROM service_tables ORDER BY created_at DESC").fetch_all(&state.db).await?;
    let s = state.settings.get().await;
    Ok(Json(Value::Array(rows.iter().map(|r| table_json(&state, &s, r)).collect())))
}

async fn validate(state: &AppState, input: &Input, ignore: Option<i64>) -> AppResult<Vec<Col>> {
    let mut e = Errors::default();
    let title = input.val("title");
    if !filled(Some(&title)) {
        e.add("title", tr!("The title field is required."));
    } else if records::taken(state, "service_tables", "title", &title, ignore).await? {
        e.add("title", tr!("The title has already been taken."));
    }
    e.check()?;
    Ok(vec![Col::plain("title", title)])
}

async fn store(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let cols = validate(&state, &input, None).await?;
    let now = state.settings.get().await.now();
    let id = records::insert(&state.db, "service_tables", &cols, now).await?;
    let title = records::php_str(&input.val("title"));
    activity::log(&state, &user, &headers, &state.t("New service table added successfully").await, title.as_deref()).await;
    Ok(Json(json!({ "message": state.t("Data saved successfully").await, "table": id })))
}

async fn show(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let row = records::find(&state, "service_tables", &id).await?;
    let s = state.settings.get().await;
    Ok(Json(table_json(&state, &s, &row)))
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
    input: Input,
) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let row = records::find(&state, "service_tables", &id).await?;
    let cols = validate(&state, &input, Some(row.i64("id"))).await?;
    let now = state.settings.get().await.now();
    records::update(&state.db, "service_tables", &row, &cols, now).await?;
    let title = records::php_str(&input.val("title"));
    activity::log(&state, &user, &headers, &state.t("Service table updated successfully").await, title.as_deref()).await;
    Ok(Json(json!({ "message": state.t("Data updated successfully").await })))
}

async fn destroy(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let row = records::find(&state, "service_tables", &id).await?;
    let id = row.i64("id");
    if records::count_where(&state, "sales", "table_id", id).await? > 0 {
        return Err(AppError::unprocessable("Unable to remove service table information is being used"));
    }
    activity::log(&state, &user, &headers, &state.t("Service table removed successfully").await, row.opt_str("title").as_deref()).await;
    sqlx::query("DELETE FROM service_tables WHERE id = ?").bind(id).execute(&state.db).await?;
    Ok(Json(json!({ "message": state.t("Data removed successfully").await })))
}
