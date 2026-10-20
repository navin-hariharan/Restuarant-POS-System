//! Reports: sales, expenses, categories, most sold items, monthly tax and
//! expense totals, stock and expiry alerts.

pub mod duration;
pub mod filters;
pub mod php;

use crate::{
    auth::AuthUser,
    db::{Db, RowExt},
    error::AppResult,
    input::Input,
    query::{Arg, Sql},
    settings::Settings,
    state::AppState,
    util::json_num,
};
use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use chrono::{Datelike, Duration};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/report-tax", post(tax))
        .route("/admin/report-expense", post(expense))
        .route("/admin/stock-alerts", get(stock_alerts))
        .route("/admin/expiry-alerts", get(expiry_alerts))
        .route("/admin/overall-category-report", get(category_report))
        .route("/admin/overall-sales-report", get(sales_report))
        .route("/admin/overall-expenses-report", get(expenses_report))
        .route("/admin/most-sold-items.report", get(most_sold_items))
}

/// A DOUBLE/DECIMAL column as the JSON number the previous API returned.
pub fn number(v: &Value) -> Value {
    match v {
        Value::Null => Value::Null,
        Value::Number(n) => n.as_f64().map(json_num).unwrap_or(Value::Number(n.clone())),
        other => json_num(crate::util::num(other)),
    }
}

/// Number of an aggregate: 0 when nothing was summed.
fn total(v: &Value) -> Value {
    match v {
        Value::Null => Value::from(0),
        other => number(other),
    }
}

/// Order type label (translated), null for unknown types.
pub async fn order_type_title(state: &AppState, key: &str) -> Value {
    let title = match key {
        "dining" => tr!("Dining"),
        "pickup" => tr!("Pickup"),
        "dilivery" => tr!("Delivery"),
        "roomservice" => tr!("Room Service"),
        _ => return Value::Null,
    };
    Value::from(state.t(title).await)
}

/// Twelve monthly sums of `col` for one year (missing months are 0).
async fn monthly(db: &Db, mut sql: Sql, col: &str) -> AppResult<Value> {
    sql.push(" GROUP BY MONTH(created_at)");
    let rows = sql.fetch_all(db).await?;
    let mut by_month: HashMap<i64, Value> = HashMap::new();
    for r in rows {
        by_month.insert(r.i64("m"), r.val(col));
    }
    let mut out = Vec::with_capacity(12);
    for m in 1..=12 {
        let v = by_month.get(&m).cloned().unwrap_or(Value::Null);
        // a zero sum reads as 0
        out.push(if crate::util::num(&v) == 0.0 { Value::from(0) } else { number(&v) });
    }
    Ok(Value::Array(out))
}

fn year_param(input: &Input, s: &Settings) -> Arg {
    match input.get("year").and_then(php::scalar) {
        Some(v) => Arg::from(v),
        None => Arg::Int(s.now().year() as i64),
    }
}

async fn tax(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(&["tax_report"])?;
    let s = state.settings.get().await;
    let mut sql = Sql::new("SELECT MONTH(created_at) AS m, SUM(tax_amount) AS v FROM sales WHERE 1=1");
    filters::sales(&mut sql, &input, &s, "");
    sql.push(" AND completed_at IS NOT NULL");
    sql.push_args(" AND YEAR(created_at) = ?", [year_param(&input, &s)]);
    Ok(Json(monthly(&state.db, sql, "v").await?))
}

async fn expense(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(&["expense_report"])?;
    let s = state.settings.get().await;
    let mut sql = Sql::new("SELECT MONTH(created_at) AS m, SUM(amount) AS v FROM expenses WHERE 1=1");
    sql.push_args(" AND YEAR(created_at) = ?", [year_param(&input, &s)]);
    Ok(Json(monthly(&state.db, sql, "v").await?))
}

async fn stock_alerts(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(&["stock_alerts"])?;
    let s = state.settings.get().await;
    let rows = Sql::new(
        "SELECT id, name, price, cost, unit, quantity, alert_quantity, description, created_at, updated_at \
         FROM ingredients WHERE quantity < alert_quantity ORDER BY id",
    )
    .fetch_all(&state.db)
    .await?;
    let list = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.val("id"),
                "name": r.val("name"),
                "price": number(&r.val("price")),
                "cost": number(&r.val("cost")),
                "unit": r.val("unit"),
                "quantity": r.val("quantity"),
                "alert_quantity": r.val("alert_quantity"),
                "description": r.val("description"),
                "created_at": s.iso_value(&r.val("created_at")),
                "updated_at": s.iso_value(&r.val("updated_at")),
            })
        })
        .collect();
    Ok(Json(Value::Array(list)))
}

async fn expiry_alerts(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(&["expiry_alerts"])?;
    let s = state.settings.get().await;
    let now = s.now();
    let limit = (now + Duration::days(5)).date();
    let rows = Sql::new("SELECT id, uuid, name, expiry_date FROM food_items WHERE expiry_date IS NOT NULL")
        .push_args(" AND DATE(expiry_date) <= ? ORDER BY id", [limit.format("%Y-%m-%d").to_string()])
        .clone()
        .fetch_all(&state.db)
        .await?;
    let list = rows
        .iter()
        .map(|r| {
            let expiry = r.opt_str("expiry_date");
            let expired = match expiry.as_deref() {
                None | Some("") | Some("0") | Some("null") => false,
                Some(d) => crate::datefmt::parse(d).map(|d| now > d).unwrap_or(false),
            };
            json!({
                "id": r.val("id"),
                "uuid": r.val("uuid"),
                "name": r.val("name"),
                "expiry_date": r.val("expiry_date"),
                "is_expired": expired,
            })
        })
        .collect();
    Ok(Json(Value::Array(list)))
}

async fn category_report(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(&["category_based_report"])?;
    let s = state.settings.get().await;
    let range = duration::advance(&input, s.now(), s.tz());
    let mut cond = Sql::new(" WHERE 1=1");
    filters::sale_items(&mut cond, &input, &s);
    range.apply(&mut cond, "created_at");

    // per category and food item, in order of first sale
    let mut items = Sql::new(
        "SELECT a.cat, a.first_id, a.qty, a.total, a.last_sold, f.item_name, f.price FROM (\
         SELECT food_category_id AS cat, food_item_id AS item, MIN(id) AS first_id, SUM(quantity) AS qty, \
         SUM(CAST(total_amount AS DOUBLE)) AS total, MAX(created_at) AS last_sold FROM sale_items",
    );
    items.push_args(&cond.text, cond.args.clone());
    items.push(" GROUP BY food_category_id, food_item_id) a JOIN sale_items f ON f.id = a.first_id ORDER BY a.first_id");
    let item_rows = items.fetch_all(&state.db).await?;

    let mut cats = Sql::new(
        "SELECT food_category_id AS cat, MIN(id) AS first_id, SUM(quantity) AS qty, \
         SUM(CAST(total_amount AS DOUBLE)) AS total FROM sale_items",
    );
    cats.push_args(&cond.text, cond.args.clone());
    cats.push(" GROUP BY food_category_id ORDER BY first_id");
    let cat_rows = cats.fetch_all(&state.db).await?;

    let ids: Vec<i64> = cat_rows.iter().filter_map(|r| r.opt_str("cat")?.trim().parse::<i64>().ok()).collect();
    let mut names: HashMap<i64, Value> = HashMap::new();
    if !ids.is_empty() {
        let mut q = Sql::new("SELECT id, name FROM food_categories WHERE 1=1");
        q.and_in("id", ids);
        for r in q.fetch_all(&state.db).await? {
            names.insert(r.i64("id"), r.val("name"));
        }
    }

    let mut grouped: HashMap<Option<String>, Vec<Value>> = HashMap::new();
    for r in &item_rows {
        let last = r.val("last_sold");
        grouped.entry(r.opt_str("cat")).or_default().push(json!({
            "item_name": r.val("item_name"),
            "total_sold_qty": int_sum(&r.val("qty")),
            "unit_price": json_num(r.f64("price")),
            "total": total(&r.val("total")),
            "last_sold_at": last,
        }));
    }
    let out: Vec<Value> = cat_rows
        .iter()
        .map(|r| {
            let cat = r.opt_str("cat");
            let name = cat.as_deref().and_then(|c| c.trim().parse::<i64>().ok()).and_then(|id| names.get(&id).cloned());
            json!({
                "category_id": php::array_key(cat.as_deref()),
                "category_name": name.unwrap_or(Value::Null),
                "items": grouped.remove(&cat).unwrap_or_default(),
                "total_amount": total(&r.val("total")),
                "total_sold_items": int_sum(&r.val("qty")),
            })
        })
        .collect();
    Ok(Json(Value::Array(out)))
}

/// SUM() of an integer column (a DECIMAL string) as a JSON integer.
fn int_sum(v: &Value) -> Value {
    Value::from(crate::util::num(v) as i64)
}

async fn sales_report(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(&["overall_sale_report"])?;
    let s = state.settings.get().await;
    let range = duration::advance(&input, s.now(), s.tz());
    let mut sql = Sql::new(
        "SELECT id, uuid, order_type, tracking, cart_total_price, cart_total_cost, payable_after_all, discount_rate, \
         discount_amount, profit_after_all, tax_amount, customer_id, table_id, progress, created_at, updated_at \
         FROM sales WHERE 1=1",
    );
    filters::sales(&mut sql, &input, &s, "");
    range.apply(&mut sql, "created_at");
    sql.push(" AND is_cancelled = 0 AND completed_at IS NOT NULL ORDER BY id");
    let rows = sql.fetch_all(&state.db).await?;

    // sums accumulate in list order, like the previous API
    let sum = |col: &str| -> Value {
        if rows.is_empty() {
            return Value::from(0);
        }
        json_num(rows.iter().fold(0.0, |acc, r| acc + r.f64(col)))
    };
    let totals = [
        ("total_price_amount", sum("cart_total_price")),
        ("total_cost_amount", sum("cart_total_cost")),
        ("total_discount_amount", sum("discount_amount")),
        ("total_payable_amount", sum("payable_after_all")),
        ("totla_profit_amount", sum("profit_after_all")),
        ("total_tax_amount", sum("tax_amount")),
    ];

    let customers = customers_by_id(&state, &s, rows.iter().filter_map(|r| r.opt_i64("customer_id")).collect()).await?;
    let tables = tables_by_id(&state.db, rows.iter().filter_map(|r| r.opt_i64("table_id")).collect()).await?;
    let mut titles: HashMap<String, Value> = HashMap::new();
    let mut list = Vec::with_capacity(rows.len());
    for r in &rows {
        let ot = r.str("order_type");
        if !titles.contains_key(&ot) {
            titles.insert(ot.clone(), order_type_title(&state, &ot).await);
        }
        list.push(json!({
            "id": r.val("id"),
            "uuid": r.val("uuid"),
            "type": titles.get(&ot).cloned().unwrap_or(Value::Null),
            "tracking": r.val("tracking"),
            "cart_total_price": number(&r.val("cart_total_price")),
            "cart_total_cost": number(&r.val("cart_total_cost")),
            "payable_after_all": number(&r.val("payable_after_all")),
            "discount_rate": number(&r.val("discount_rate")),
            "discount_amount": number(&r.val("discount_amount")),
            "profit_after_all": number(&r.val("profit_after_all")),
            "tax_amount": number(&r.val("tax_amount")),
            "customer": r.opt_i64("customer_id").and_then(|id| customers.get(&id).cloned()).unwrap_or(Value::Null),
            "table": r.opt_i64("table_id").and_then(|id| tables.get(&id).cloned()).unwrap_or(Value::Null),
            "progress": r.val("progress"),
            "created_at": s.fmt_value(&r.val("created_at")),
            "updated_at": s.fmt_value(&r.val("updated_at")),
        }));
    }

    let mut out = Map::new();
    for (k, v) in totals {
        out.insert(k.into(), v);
    }
    out.insert("orders".into(), Value::from(rows.len()));
    out.insert("list".into(), Value::Array(list));
    Ok(Json(Value::Object(out)))
}

/// Customers as shown on reports and the POS, with their 10 latest orders.
async fn customers_by_id(state: &AppState, s: &Settings, mut ids: Vec<i64>) -> AppResult<HashMap<i64, Value>> {
    ids.sort_unstable();
    ids.dedup();
    let mut out = HashMap::new();
    if ids.is_empty() {
        return Ok(out);
    }
    let mut q =
        Sql::new("SELECT id, uuid, name, email, address, phone, shipping_addresses, created_at, updated_at FROM customers WHERE 1=1");
    q.and_in("id", ids.clone());
    let customers = q.fetch_all(&state.db).await?;

    let mut h = Sql::new(
        "SELECT customer_id, id, uuid, tracking, updated_at FROM (SELECT customer_id, id, uuid, tracking, updated_at, \
         ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY created_at DESC, id ASC) AS rn FROM sales WHERE 1=1",
    );
    h.and_in("customer_id", ids);
    h.push(") latest WHERE rn <= 10 ORDER BY customer_id, rn");
    let now = s.now();
    let mut history: HashMap<i64, Vec<Value>> = HashMap::new();
    for r in h.fetch_all(&state.db).await? {
        let updated = r.val("updated_at");
        let human = updated.as_str().and_then(crate::datefmt::parse).map(|d| php::diff_for_humans(d, now));
        history.entry(r.i64("customer_id")).or_default().push(json!({
            "id": r.val("id"),
            "uuid": r.val("uuid"),
            "tracking": r.val("tracking"),
            "created_at": human,
            "updated_at": s.fmt_value(&updated),
        }));
    }

    for c in customers {
        let id = c.i64("id");
        let full_name = format!("{} {} {}", c.str("name"), c.str("email"), c.str("phone")).trim().to_string();
        let shipping = match php::json_text(c.opt_str("shipping_addresses").as_deref()) {
            Value::Null => json!([]),
            v => v,
        };
        out.insert(
            id,
            json!({
                "id": id,
                "uuid": c.val("uuid"),
                "full_name": full_name,
                "name": c.val("name"),
                "email": c.val("email"),
                "address": c.val("address"),
                "phone": c.val("phone"),
                "shipping_addresses": shipping,
                "history": history.remove(&id).unwrap_or_default(),
                "created_at": s.fmt_value(&c.val("created_at")),
                "updated_at": s.fmt_value(&c.val("updated_at")),
            }),
        );
    }
    Ok(out)
}

async fn tables_by_id(db: &Db, mut ids: Vec<i64>) -> AppResult<HashMap<i64, Value>> {
    ids.sort_unstable();
    ids.dedup();
    let mut out = HashMap::new();
    if ids.is_empty() {
        return Ok(out);
    }
    let mut q = Sql::new("SELECT id, title, is_booked FROM service_tables WHERE 1=1");
    q.and_in("id", ids);
    for r in q.fetch_all(db).await? {
        out.insert(r.i64("id"), json!({ "id": r.val("id"), "title": r.val("title"), "is_booked": r.bool("is_booked") }));
    }
    Ok(out)
}

async fn expenses_report(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(&["overall_expense_report"])?;
    let s = state.settings.get().await;
    let range = duration::advance(&input, s.now(), s.tz());
    let mut sql = Sql::new("SELECT id, title, amount, created_at, updated_at FROM expenses WHERE 1=1");
    filters::expenses(&mut sql, &input, &s);
    range.apply(&mut sql, "created_at");
    sql.push(" ORDER BY id");
    let rows = sql.fetch_all(&state.db).await?;
    let total = if rows.is_empty() { Value::from(0) } else { json_num(rows.iter().fold(0.0, |acc, r| acc + r.f64("amount"))) };
    let list: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.val("id"),
                "title": r.val("title"),
                "amount": number(&r.val("amount")),
                "created_at": s.fmt_value(&r.val("created_at")),
                "updated_at": s.fmt_value(&r.val("updated_at")),
            })
        })
        .collect();
    Ok(Json(json!({ "total_amount": total, "orders": rows.len(), "list": list })))
}

async fn most_sold_items(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(&["most_sold_items_report"])?;
    let s = state.settings.get().await;
    let per_page = match input.data.get("per_page") {
        None | Some(Value::Null) => 25,
        v => php::int_cast(v),
    }
    .clamp(1, 200);
    let page = php::page_number(input.data.get("page"));
    let range = duration::advance(&input, s.now(), s.tz());

    let mut sql = Sql::new("SELECT food_item_id, SUM(quantity) AS total_quantity FROM sale_items WHERE 1=1");
    filters::sale_items(&mut sql, &input, &s);
    range.apply(&mut sql, "created_at");
    sql.push(" GROUP BY food_item_id");
    let count = Sql { text: format!("SELECT COUNT(*) AS c FROM ({}) AS aggregate_table", sql.text), args: sql.args.clone() };
    let total = count.scalar_f64(&state.db).await? as i64;
    sql.push(&format!(" ORDER BY total_quantity DESC, food_item_id ASC LIMIT {} OFFSET {}", per_page, (page - 1).saturating_mul(per_page)));
    let rows = if total > 0 { sql.fetch_all(&state.db).await? } else { vec![] };

    let ids: Vec<i64> = rows.iter().filter_map(|r| r.opt_i64("food_item_id")).collect();
    let mut items: HashMap<i64, Map<String, Value>> = HashMap::new();
    if !ids.is_empty() {
        let mut q = Sql::new("SELECT id, name, price, image FROM food_items WHERE 1=1");
        q.and_in("id", ids);
        for r in q.fetch_all(&state.db).await? {
            items.insert(r.i64("id"), r);
        }
    }
    let deleted = state.t("Deleted item").await;
    let list: Vec<Value> = rows
        .iter()
        .map(|r| {
            let item = r.opt_i64("food_item_id").and_then(|id| items.get(&id));
            json!({
                "food_item_id": r.val("food_item_id"),
                "sold_qty": r.val("total_quantity"),
                "price": item.map(|i| number(&i.val("price"))).unwrap_or(Value::Null),
                "item_name": item.and_then(|i| i.opt_str("name")).map(Value::from).unwrap_or_else(|| Value::from(deleted.clone())),
                "image": item.map(|i| Value::from(food_item_image(&state, i))).unwrap_or(Value::Null),
            })
        })
        .collect();
    let last_page = ((total + per_page - 1) / per_page).max(1);
    Ok(Json(json!({
        "list": list,
        "pagination": { "current_page": page, "last_page": last_page, "per_page": per_page, "total": total },
    })))
}

/// Public URL of a food item's picture (the default picture when it has none).
pub fn food_item_image(state: &AppState, row: &Map<String, Value>) -> String {
    match row.opt_str("image").filter(|s| !s.is_empty()) {
        Some(p) => state.storage_url(&p),
        None => state.asset_url("images/default/product.png"),
    }
}
