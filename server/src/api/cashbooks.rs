//! Cash registers ("cash books"): a till opens one with a float, orders taken
//! while it is open are linked to it, and it can be closed once every order
//! is finished. Only served when cash book mode is on.

use super::pos::{
    common,
    common::{d, ids_of, load_pos_customers, tx_exec, tx_row, Row},
    missing,
};
use crate::{
    activity,
    auth::AuthUser,
    db::RowExt,
    error::{AppError, AppResult},
    input::Input,
    query::{paged, Arg, Sql},
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, patch},
    Json, Router,
};
use serde_json::{json, Value};
use std::collections::HashMap;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/cashbooks", get(current).post(store))
        .route("/cashbooks/{cash_book}", patch(update))
        .route("/admin/cash-books", get(index))
        .route("/admin/cash-books/{cash_book}", get(show))
}

/// The routes only exist while cash book mode is on.
async fn enabled(state: &AppState) -> AppResult<()> {
    if state.settings.get().await.modes().cashbooks {
        Ok(())
    } else {
        Err(AppError::not_found())
    }
}

#[derive(Default)]
struct Totals {
    sales: f64,
    discount: f64,
    tax: f64,
    profit: f64,
    items: f64,
    count: i64,
    in_progress: i64,
    completed: i64,
    cancelled: i64,
    expenses: f64,
}

/// CashBookResource for each register row (sales and expenses loaded in batches).
async fn resources(state: &AppState, books: &[Row]) -> AppResult<Vec<Value>> {
    let s = state.settings.get().await;
    let ids = ids_of(books, "id");
    let users = super::pos::common::by_ids(&state.db, "users", ids_of(books, "user_id")).await?;
    let mut totals: HashMap<i64, Totals> = HashMap::new();
    let mut orders: HashMap<i64, Vec<Row>> = HashMap::new();
    if !ids.is_empty() {
        let mut q = Sql::new("SELECT * FROM sales WHERE 1=1");
        q.and_in("cash_book_id", ids.clone());
        q.push(" ORDER BY id");
        let sales = q.fetch_all(&state.db).await?;
        for o in &sales {
            let t = totals.entry(o.i64("cash_book_id")).or_default();
            t.sales += o.f64("payable_after_all");
            t.discount += o.f64("discount_amount");
            t.tax += o.f64("tax_amount");
            t.profit += o.f64("profit_after_all");
            t.items += o.f64("cart_total_items");
            t.count += 1;
            let done = o.opt_str("completed_at").is_some();
            if !o.bool("is_cancelled") && !done {
                t.in_progress += 1;
            }
            if o.opt_str("prepared_at").is_some() && done {
                t.completed += 1;
            }
            if o.bool("is_cancelled") {
                t.cancelled += 1;
            }
        }
        for o in sales {
            orders.entry(o.i64("cash_book_id")).or_default().push(o);
        }
        let mut q = Sql::new("SELECT cash_book_id, SUM(amount) AS total FROM expenses WHERE 1=1");
        q.and_in("cash_book_id", ids.clone());
        q.push(" GROUP BY cash_book_id");
        for e in q.fetch_all(&state.db).await? {
            totals.entry(e.i64("cash_book_id")).or_default().expenses = e.f64("total");
        }
        let customers = load_pos_customers(state, orders.values().flatten().filter_map(|o| o.opt_i64("customer_id"))).await?;
        let mut built: HashMap<i64, Vec<Value>> = HashMap::new();
        for (book, list) in &orders {
            built.insert(
                *book,
                list.iter()
                    .map(|o| {
                        json!({
                            "id": o.val("id"),
                            "uuid": o.val("uuid"),
                            "tracking": o.val("tracking"),
                            "cart_total_price": o.val("cart_total_price"),
                            "cart_total_cost": o.val("cart_total_cost"),
                            "payable_after_all": o.val("payable_after_all"),
                            "discount_rate": o.val("discount_rate"),
                            "is_discount_in_percentage": super::pos::common::bool_col(o, "is_discount_in_percentage"),
                            "discount_amount": o.val("discount_amount"),
                            "profit_after_all": o.val("profit_after_all"),
                            "tax_amount": o.val("tax_amount"),
                            "customer": o.opt_i64("customer_id").and_then(|c| customers.get(&c)).cloned().unwrap_or(Value::Null),
                            "completed_at": o.val("completed_at"),
                            "created_at": d(&s, o, "created_at"),
                            "updated_at": d(&s, o, "updated_at"),
                        })
                    })
                    .collect(),
            );
        }
        return Ok(books.iter().map(|b| resource(&s, b, &users, totals.get(&b.i64("id")), built.remove(&b.i64("id")).unwrap_or_default())).collect());
    }
    Ok(vec![])
}

fn resource(s: &crate::settings::Settings, b: &Row, users: &HashMap<i64, Row>, t: Option<&Totals>, orders: Vec<Value>) -> Value {
    let empty = Totals::default();
    let t = t.unwrap_or(&empty);
    let n = crate::util::json_num;
    let final_amount = crate::util::round(b.f64("opening_amount") + t.sales - t.expenses, 2);
    json!({
        "id": b.val("id"),
        "uuid": b.val("uuid"),
        "user": b.opt_i64("user_id").and_then(|u| users.get(&u)).map(|u| u.val("name")).unwrap_or(Value::Null),
        "opening_amount": b.val("opening_amount"),
        "closed": super::pos::common::bool_col(b, "closed"),
        "sales_amount": n(t.sales),
        "discount_amount": n(t.discount),
        "tax_amount": n(t.tax),
        "total_profit": n(t.profit),
        "sold_items": n(t.items),
        "sales": t.count,
        "in_progress": t.in_progress,
        "in_completed": t.completed,
        "in_cancelled": t.cancelled,
        "is_closable": t.completed + t.cancelled == t.count,
        "expenses_amount": n(t.expenses),
        "final_amount": n(final_amount),
        "orders": orders,
        "created_at": d(s, b, "created_at"),
        "updated_at": d(s, b, "updated_at"),
    })
}

async fn one(state: &AppState, row: Row) -> AppResult<Value> {
    Ok(resources(state, &[row]).await?.pop().unwrap_or(Value::Null))
}

async fn by_uuid(state: &AppState, uuid: &str) -> AppResult<Row> {
    let mut q = Sql::new("SELECT * FROM cash_books WHERE uuid = ?");
    q.args.push(uuid.into());
    q.fetch_optional(&state.db).await?.ok_or_else(AppError::not_found)
}

async fn current(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    enabled(&state).await?;
    user.require(&["pos_portal"])?;
    let mut q = Sql::new("SELECT * FROM cash_books WHERE user_id = ?");
    q.args.push(user.id.into());
    q.push(" AND closed = 0 ORDER BY id LIMIT 1");
    match q.fetch_optional(&state.db).await? {
        Some(b) => Ok(common::reply(one(&state, b).await?)),
        None => Ok(common::reply(json!([]))),
    }
}

async fn store(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    enabled(&state).await?;
    user.require(&["pos_portal"])?;
    if missing(&input, "opening_amount") {
        return Err(AppError::field("opening_amount", "The opening amount field is required."));
    }
    let amount = input.f64("opening_amount").ok_or_else(|| AppError::field("opening_amount", "The opening amount must be a number."))?;
    if amount.abs() >= 1e8 {
        return Err(AppError::field("opening_amount", "The opening amount must be less than 100000000."));
    }
    let now = state.settings.get().await.now();
    let uuid = crate::util::uuid();
    let mut tx = state.db.begin().await?;
    // One open register per user: the user row serializes concurrent opens.
    tx_row(&mut tx, "SELECT id FROM users WHERE id = ? FOR UPDATE", vec![user.id.into()]).await?;
    if super::pos::common::open_register_id(&mut tx, user.id).await?.is_some() {
        return Err(AppError::unprocessable("You have already cash register opened"));
    }
    let id = tx_exec(
        &mut tx,
        "INSERT INTO cash_books (uuid, opening_amount, closed, user_id, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)",
        vec![uuid.into(), Arg::Float(amount), user.id.into(), now.into(), now.into()],
    )
    .await?
    .last_insert_id() as i64;
    tx.commit().await?;
    activity::log(&state, &user, &headers, &state.t("Cashbook register opened successfully").await, None).await;
    let row = { let mut q = Sql::new("SELECT * FROM cash_books WHERE id = ?"); q.args.push(id.into()); q }.fetch_optional(&state.db).await?.ok_or_else(AppError::not_found)?;
    // The fresh model is returned as built: the amount as sent, `closed` unset.
    let mut cashbook = one(&state, row).await?;
    if let Some(o) = cashbook.as_object_mut() {
        if o.contains_key("opening_amount") {
            o.insert("opening_amount".into(), input.val("opening_amount"));
        }
        if o.contains_key("closed") {
            o.insert("closed".into(), Value::Null);
        }
    }
    Ok(common::reply(json!({
        "message": state.t("Cash register opened successfully").await,
        "cashbook": cashbook,
    })))
}

async fn update(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(uuid): Path<String>) -> AppResult<Json<Value>> {
    enabled(&state).await?;
    user.require(&["pos_portal"])?;
    let book = by_uuid(&state, &uuid).await?;
    if book.opt_i64("user_id") != Some(user.id) && user.role_id >= 2 {
        return Err(AppError::forbidden("You have not permit to perform this request"));
    }
    let now = state.settings.get().await.now();
    let mut tx = state.db.begin().await?;
    tx_row(&mut tx, "SELECT id FROM cash_books WHERE id = ? FOR UPDATE", vec![book.i64("id").into()]).await?;
    let counts = tx_row(
        &mut tx,
        "SELECT COUNT(*) AS total, COALESCE(SUM(prepared_at IS NOT NULL AND completed_at IS NOT NULL), 0) AS completed, \
         COALESCE(SUM(is_cancelled = 1), 0) AS cancelled FROM sales WHERE cash_book_id = ?",
        vec![book.i64("id").into()],
    )
    .await?
    .unwrap_or_default();
    if counts.i64("completed") + counts.i64("cancelled") != counts.i64("total") {
        return Err(AppError::unprocessable("Please clear all orders in progress before closing the register"));
    }
    tx_exec(&mut tx, "UPDATE cash_books SET closed = 1, updated_at = ? WHERE id = ?", vec![now.into(), book.i64("id").into()]).await?;
    tx.commit().await?;
    activity::log(&state, &user, &headers, &state.t("Cashbook register closed successfully").await, None).await;
    Ok(common::reply(json!({ "message": state.t("Register has been closed").await })))
}

const SORT: [&str; 6] = ["id", "user_id", "opening_amount", "closed", "created_at", "updated_at"];

async fn index(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    enabled(&state).await?;
    user.require(&["cashbooks_report"])?;
    let (col, order) = input.sort(&SORT, "created_at", "asc");
    let q = Sql::new(format!("SELECT * FROM cash_books ORDER BY `{col}` {order}, id {order}"));
    let (rows, pagination) = q.paginate(&state.db, input.page(10)).await?;
    Ok(common::reply(paged(resources(&state, &rows).await?, pagination)))
}

async fn show(State(state): State<AppState>, user: AuthUser, Path(uuid): Path<String>) -> AppResult<Json<Value>> {
    enabled(&state).await?;
    user.require(&["cashbooks_report"])?;
    let book = by_uuid(&state, &uuid).await?;
    Ok(common::reply(one(&state, book).await?))
}
