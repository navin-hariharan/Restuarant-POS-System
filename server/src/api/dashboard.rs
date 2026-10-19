//! Dashboard figures: sales totals for the current and previous period, the
//! monthly sales chart and the latest sold items.

use super::reports::{duration, food_item_image, number};
use crate::{
    auth::AuthUser,
    db::RowExt,
    error::AppResult,
    input::Input,
    query::Sql,
    state::AppState,
};
use axum::{extract::State, routing::get, Json, Router};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

pub fn router() -> Router<AppState> {
    Router::new().route("/admin/dashboard-states", get(states))
}

const SALE_SUMS: [&str; 7] =
    ["cart_total_price", "cart_total_cost", "discount_amount", "payable_after_all", "profit_after_all", "tax_amount", "tip_amount"];

/// A SUM() result: 0 when empty or zero.
fn sum_value(v: &Value) -> Value {
    if crate::util::num(v) == 0.0 {
        Value::from(0)
    } else {
        number(v)
    }
}

async fn sale_sums(state: &AppState, range: &duration::Range) -> AppResult<Map<String, Value>> {
    let cols: Vec<String> = SALE_SUMS.iter().map(|c| format!("SUM({c}) AS {c}")).collect();
    let mut sql = Sql::new(format!("SELECT {} FROM sales WHERE completed_at IS NOT NULL", cols.join(", ")));
    range.apply(&mut sql, "created_at");
    Ok(sql.fetch_optional(&state.db).await?.unwrap_or_default())
}

async fn expense_sum(state: &AppState, range: &duration::Range) -> AppResult<Value> {
    let mut sql = Sql::new("SELECT SUM(amount) AS v FROM expenses WHERE 1=1");
    range.apply(&mut sql, "created_at");
    Ok(sum_value(&sql.fetch_optional(&state.db).await?.map(|r| r.val("v")).unwrap_or(Value::Null)))
}

async fn chart(state: &AppState, range: &duration::Range) -> AppResult<Value> {
    let mut sql = Sql::new("SELECT MONTH(created_at) AS month, SUM(payable_after_all) AS v FROM sales WHERE completed_at IS NOT NULL");
    range.apply(&mut sql, "created_at");
    sql.push(" GROUP BY MONTH(created_at)");
    let by_month: HashMap<i64, Value> = sql.fetch_all(&state.db).await?.into_iter().map(|r| (r.i64("month"), r.val("v"))).collect();
    Ok(Value::Array(
        (1..=12)
            .map(|m| match by_month.get(&m) {
                Some(v) if !v.is_null() => number(v),
                _ => Value::from(0),
            })
            .collect(),
    ))
}

async fn states(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(&["dashboard_access"])?;
    let s = state.settings.get().await;
    let now = s.now();
    let period = input.str("is_duration");
    let current = duration::simple(period.as_deref(), false, now);
    let last = duration::simple(period.as_deref(), true, now);

    let cur = sale_sums(&state, &current).await?;
    let prev = sale_sums(&state, &last).await?;
    let mut out = Map::new();
    for (col, key) in SALE_SUMS.iter().zip([
        "total_price_amount",
        "total_cost_amount",
        "total_discount_amount",
        "total_payable_amount",
        "total_profit_amount",
        "total_tax_amount",
        "total_tip_amount",
    ]) {
        out.insert(key.to_string(), sum_value(&cur.val(col)));
        out.insert(format!("last_{key}"), sum_value(&prev.val(col)));
    }
    out.insert("expense_amount".into(), expense_sum(&state, &current).await?);
    out.insert("last_expense_amount".into(), expense_sum(&state, &last).await?);
    out.insert("chart".into(), chart(&state, &current).await?);
    out.insert("last_chart".into(), chart(&state, &last).await?);
    out.insert("last_sold_items".into(), last_sold_items(&state).await?);
    Ok(Json(Value::Object(out)))
}

async fn last_sold_items(state: &AppState) -> AppResult<Value> {
    let s = state.settings.get().await;
    let rows = Sql::new("SELECT * FROM sale_items ORDER BY created_at DESC, id DESC LIMIT 10").fetch_all(&state.db).await?;

    let cat_ids: Vec<i64> = rows.iter().filter_map(|r| r.opt_str("food_category_id")?.trim().parse::<i64>().ok()).collect();
    let mut cats: HashMap<i64, Value> = HashMap::new();
    if !cat_ids.is_empty() {
        let mut q = Sql::new(
            "SELECT c.id, c.name, c.image, c.created_at, (SELECT COUNT(*) FROM food_items f WHERE f.food_category_id = c.id) AS linked \
             FROM food_categories c WHERE 1=1",
        );
        q.and_in("c.id", cat_ids);
        for c in q.fetch_all(&state.db).await? {
            let image = match c.opt_str("image").filter(|i| !i.is_empty()) {
                Some(p) => state.storage_url(&p),
                None => state.asset_url("images/default/category.png"),
            };
            cats.insert(
                c.i64("id"),
                json!({
                    "id": c.val("id"),
                    "name": c.val("name"),
                    "slug": null,
                    "image": image,
                    "linked": c.i64("linked"),
                    "created_at": s.fmt_value(&c.val("created_at")),
                }),
            );
        }
    }

    let item_ids: Vec<i64> = rows.iter().filter_map(|r| r.opt_i64("food_item_id")).collect();
    let mut images: HashMap<i64, String> = HashMap::new();
    if !item_ids.is_empty() {
        let mut q = Sql::new("SELECT id, image FROM food_items WHERE 1=1");
        q.and_in("id", item_ids);
        for r in q.fetch_all(&state.db).await? {
            images.insert(r.i64("id"), food_item_image(state, &r));
        }
    }

    Ok(Value::Array(
        rows.iter()
            .map(|r| {
                let cat = r.opt_str("food_category_id").and_then(|c| c.trim().parse::<i64>().ok()).and_then(|id| cats.get(&id).cloned());
                // a deleted food item has no picture
                let image = r.opt_i64("food_item_id").and_then(|id| images.get(&id).cloned());
                json!({
                    "id": r.val("id"),
                    "item_name": r.val("item_name"),
                    "price": r.val("price"),
                    "quantity": r.val("quantity"),
                    "total_amount": r.val("total_amount"),
                    "category": cat,
                    "image": image,
                    "created_at": s.fmt_value(&r.val("created_at")),
                    "updated_at": s.fmt_value(&r.val("updated_at")),
                })
            })
            .collect(),
    ))
}
