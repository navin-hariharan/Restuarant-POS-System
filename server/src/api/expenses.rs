//! Expenses (Expenses screen), with batch delete.

use super::records::{self, filled, Col, Row};
use super::expense_types::type_json;
use crate::{
    activity,
    auth::AuthUser,
    db::RowExt,
    error::{AppResult, Errors},
    input::Input,
    query::{paged, Sql},
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
use std::collections::HashMap;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/expenses", get(index).post(store))
        .route("/admin/expenses/{expense}", get(show))
        .route("/admin/expense-rows-destroy", delete(destroy_batch))
        .merge(
            Router::new()
                .route("/admin/expenses/{expense}", delete(destroy).put(update).patch(update))
                .route_layer(axum::middleware::from_fn(crate::middleware::demo_mode)),
        )
}

const MANAGE: &str = "manage_expenses";
const SORTABLE: [&str; 9] = ["id", "title", "amount", "description", "expense_type_id", "expense_date", "cash_book_id", "created_at", "updated_at"];

/// ExpenseResource (`types` holds the expense types by id)
fn expense_json(s: &Settings, r: &Row, types: &HashMap<i64, Row>) -> Value {
    let kind = r.opt_i64("expense_type_id").and_then(|id| types.get(&id)).map(|t| type_json(s, t)).unwrap_or(Value::Null);
    json!({
        "id": r.get("id"),
        "title": r.get("title"),
        "amount": records::num(r, "amount"),
        "description": r.get("description"),
        "type": kind,
        "expense_type_id": r.get("expense_type_id"),
        "expense_date": r.get("expense_date"),
        "created_at": records::date(s, r, "created_at"),
        "updated_at": records::date(s, r, "updated_at"),
    })
}

async fn types_for(state: &AppState, rows: &[Row]) -> AppResult<HashMap<i64, Row>> {
    let mut ids: Vec<i64> = rows.iter().filter_map(|r| r.opt_i64("expense_type_id")).collect();
    ids.sort_unstable();
    ids.dedup();
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let mut q = Sql::new("SELECT * FROM expense_types WHERE 1=1");
    q.and_in("id", ids);
    Ok(q.fetch_all(&state.db).await?.into_iter().map(|t| (t.i64("id"), t)).collect())
}

async fn index(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let s = state.settings.get().await;
    let mut q = Sql::new("SELECT * FROM expenses WHERE 1=1");
    if let Some(term) = input.opt_str("search") {
        let p = s.search_pattern(&term);
        q.push_args(" AND (title LIKE ? OR amount LIKE ?)", [p.clone(), p]);
    }
    for key in ["category", "category_id"] {
        if let Some(category) = input.opt_str(key) {
            q.and("expense_type_id = ?", category);
        }
    }
    let (col, order) = input.sort(&SORTABLE, "created_at", "asc");
    q.push(&format!(" ORDER BY {} {order}", crate::db::ident(&col)));
    let (rows, pagination) = q.paginate(&state.db, input.page(10)).await?;
    let types = types_for(&state, &rows).await?;
    Ok(Json(paged(rows.iter().map(|r| expense_json(&s, r, &types)).collect(), pagination)))
}

async fn validate(state: &AppState, input: &Input, ignore: Option<i64>) -> AppResult<Vec<Col>> {
    let mut e = Errors::default();
    let title = input.val("title");
    if !filled(Some(&title)) {
        e.add("title", tr!("The title field is required."));
    } else if records::taken(state, "expenses", "title", &title, ignore).await? {
        e.add("title", tr!("The title has already been taken."));
    }
    let amount = input.val("amount");
    if !filled(Some(&amount)) {
        e.add("amount", tr!("The amount field is required."));
    } else if !records::is_numeric(&amount) {
        e.add("amount", tr!("The amount must be a number."));
    }
    let kind = input.val("expense_type_id");
    if !filled(Some(&kind)) {
        e.add("expense_type_id", tr!("The expense type id field is required."));
    } else if !exists(state, "expense_types", &kind).await? {
        e.add("expense_type_id", tr!("The selected expense type id is invalid."));
    }
    e.check()?;
    let mut cols = vec![Col::plain("title", title), Col::plain("amount", amount), Col::plain("expense_type_id", kind)];
    for key in ["description", "expense_date"] {
        if input.present(key) {
            cols.push(Col::plain(key, input.val(key)));
        }
    }
    Ok(cols)
}

/// `exists:<table>,id` for a scalar id.
pub(crate) async fn exists(state: &AppState, table: &'static str, id: &Value) -> AppResult<bool> {
    let Some(id) = records::php_str(id).and_then(|s| s.trim().parse::<i64>().ok()) else { return Ok(false) };
    Ok(records::count_where(state, table, "id", id).await? > 0)
}

async fn store(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let mut cols = validate(&state, &input, None).await?;
    let s = state.settings.get().await;
    if s.modes().cashbooks {
        // The open cashbook of the signed-in user, when there is one
        let open: Option<i64> = sqlx::query_scalar("SELECT CAST(id AS SIGNED) FROM cash_books WHERE user_id = ? AND closed = 0 ORDER BY id LIMIT 1")
            .bind(user.id)
            .fetch_optional(&state.db)
            .await?;
        cols.push(Col::plain("cash_book_id", open.map(Value::from).unwrap_or(Value::Null)));
    }
    let id = records::insert(&state.db, "expenses", &cols, s.now()).await?;
    activity::log(&state, &user, &headers, &state.t("New expense addded successfully").await, None).await;
    Ok(Json(json!({ "message": state.t("Data saved successfully").await, "expense": id })))
}

async fn show(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let row = records::find(&state, "expenses", &id).await?;
    let types = types_for(&state, std::slice::from_ref(&row)).await?;
    let s = state.settings.get().await;
    Ok(Json(expense_json(&s, &row, &types)))
}

async fn update(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(id): Path<String>, input: Input) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let row = records::find(&state, "expenses", &id).await?;
    let cols = validate(&state, &input, Some(row.i64("id"))).await?;
    let now = state.settings.get().await.now();
    records::update(&state.db, "expenses", &row, &cols, now).await?;
    activity::log(&state, &user, &headers, &state.t("Expense information updated successfully").await, None).await;
    Ok(Json(json!({ "message": state.t("Data updated successfully").await })))
}

async fn destroy(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let row = records::find(&state, "expenses", &id).await?;
    activity::log(&state, &user, &headers, &state.t("Expense removed successfully").await, None).await;
    sqlx::query("DELETE FROM expenses WHERE id = ?").bind(row.i64("id")).execute(&state.db).await?;
    Ok(Json(json!({ "message": state.t("Data removed successfully").await })))
}

/// DELETE with `rows: [ids]`
async fn destroy_batch(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let ids = records::id_list(input.get("rows"));
    if !ids.is_empty() {
        let mut q = Sql::new("SELECT id FROM expenses WHERE 1=1");
        q.and_in("id", ids);
        let found: Vec<i64> = q.fetch_all(&state.db).await?.iter().map(|r| r.i64("id")).collect();
        if !found.is_empty() {
            let mut tx = state.db.begin().await?;
            let mut del = Sql::new("DELETE FROM expenses WHERE 1=1");
            del.and_in("id", found.clone());
            crate::query::bind_all(sqlx::query(&del.text), &del.args).execute(&mut *tx).await?;
            tx.commit().await?;
            let msg = state.t("Expense removed successfully").await;
            for _ in &found {
                activity::log(&state, &user, &headers, &msg, None).await;
            }
        }
    }
    Ok(Json(json!({ "message": state.t("Data removed successfully").await })))
}
