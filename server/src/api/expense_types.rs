//! Expense types (Expenses > Expense types).

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
        .route("/admin/expense-types", get(index).post(store))
        .route("/admin/expense-types.list", get(list))
        .route("/admin/expense-types/{expense_type}", get(show).put(update).patch(update))
        .merge(
            Router::new()
                .route("/admin/expense-types/{expense_type}", delete(destroy))
                .route_layer(axum::middleware::from_fn(crate::middleware::demo_mode)),
        )
}

const MANAGE: &str = "manage_expense_types";

/// ExpenseTypeResource
pub fn type_json(s: &Settings, r: &Row) -> Value {
    json!({
        "id": r.get("id"),
        "title": r.get("title"),
        "created_at": records::date(s, r, "created_at"),
        "updated_at": records::date(s, r, "updated_at"),
    })
}

async fn index(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(&[MANAGE, "manage_expenses"])?;
    let rows = Sql::new("SELECT * FROM expense_types ORDER BY created_at DESC").fetch_all(&state.db).await?;
    let s = state.settings.get().await;
    Ok(Json(Value::Array(rows.iter().map(|r| type_json(&s, r)).collect())))
}

/// All types for the selects of other screens (expense form, reports, exports).
async fn list(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(&["manage_expenses", MANAGE, "overall_expense_report", "import_exports"])?;
    let rows = Sql::new("SELECT * FROM expense_types").fetch_all(&state.db).await?;
    let s = state.settings.get().await;
    Ok(Json(Value::Array(rows.iter().map(|r| type_json(&s, r)).collect())))
}

async fn validate(state: &AppState, input: &Input, ignore: Option<i64>) -> AppResult<Vec<Col>> {
    let mut e = Errors::default();
    let title = input.val("title");
    if !filled(Some(&title)) {
        e.add("title", tr!("The title field is required."));
    } else if records::taken(state, "expense_types", "title", &title, ignore).await? {
        e.add("title", tr!("The title has already been taken."));
    }
    e.check()?;
    Ok(vec![Col::plain("title", title)])
}

async fn store(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let cols = validate(&state, &input, None).await?;
    let now = state.settings.get().await.now();
    let id = records::insert(&state.db, "expense_types", &cols, now).await?;
    activity::log(&state, &user, &headers, &state.t("New expense type addded successfully").await, None).await;
    Ok(Json(json!({ "message": state.t("Data saved successfully").await, "type": id })))
}

async fn show(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let row = records::find(&state, "expense_types", &id).await?;
    let s = state.settings.get().await;
    Ok(Json(type_json(&s, &row)))
}

async fn update(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(id): Path<String>, input: Input) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let row = records::find(&state, "expense_types", &id).await?;
    let cols = validate(&state, &input, Some(row.i64("id"))).await?;
    let now = state.settings.get().await.now();
    records::update(&state.db, "expense_types", &row, &cols, now).await?;
    activity::log(&state, &user, &headers, &state.t("Expense type updated successfully").await, None).await;
    Ok(Json(json!({ "message": state.t("Data updated successfully").await })))
}

async fn destroy(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let row = records::find(&state, "expense_types", &id).await?;
    let id = row.i64("id");
    if records::count_where(&state, "expenses", "expense_type_id", id).await? > 0 {
        return Err(AppError::unprocessable("This expense category is being used"));
    }
    activity::log(&state, &user, &headers, &state.t("Expense type removed successfully").await, None).await;
    sqlx::query("DELETE FROM expense_types WHERE id = ?").bind(id).execute(&state.db).await?;
    Ok(Json(json!({ "message": state.t("Data removed successfully").await })))
}
