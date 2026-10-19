//! Ingredient stock: consumption when orders are placed (item consumption
//! mode) and restocking when they are cancelled.
//!
//! Invariant: while item consumption mode is on, a sale's ingredients are
//! taken from stock exactly once while the sale is checked out and neither
//! cancelled nor deleted. Every function runs inside the transaction that
//! changes the sale.

use crate::{
    api::pos::{common::tx_exec, php},
    db::{rows_json, RowExt},
    error::AppResult,
    query::{bind_all, Arg},
};
use chrono::NaiveDateTime;
use serde_json::Value;
use sqlx::MySqlConnection;
use std::collections::{BTreeMap, HashMap};

/// Ingredient id -> quantity used by a list of cart lines.
pub async fn consumption(conn: &mut MySqlConnection, items: &[Value]) -> AppResult<BTreeMap<i64, f64>> {
    // Recipes are looked up by the uuid of the product or variant on each line.
    let mut product_uuids = Vec::new();
    let mut variant_uuids = Vec::new();
    let mut modifier_ids = Vec::new();
    for item in items {
        let Some(o) = item.as_object() else { continue };
        if let Some(u) = o.get("uuid").and_then(Value::as_str) {
            if php::empty(o.get("food_item_id")) {
                product_uuids.push(u.to_string());
            } else {
                variant_uuids.push(u.to_string());
            }
        }
        for m in modifier_list(o.get("modifiers")) {
            if let Some(id) = m.get("id").and_then(crate::api::pos::common::fk_id) {
                modifier_ids.push(id);
            }
        }
    }
    let products = recipes(conn, "food_items", "food_item_id", &product_uuids).await?;
    let variants = recipes(conn, "food_item_attributes", "food_item_attribute_id", &variant_uuids).await?;
    let modifiers = modifier_recipes(conn, &modifier_ids).await?;

    let mut usage: BTreeMap<i64, f64> = BTreeMap::new();
    let mut collect = |recipe: Option<&Vec<(i64, f64)>>, qty: f64| {
        for (ingredient, per_unit) in recipe.into_iter().flatten() {
            *usage.entry(*ingredient).or_insert(0.0) += per_unit * qty;
        }
    };
    for item in items {
        let Some(o) = item.as_object() else { continue };
        let qty = php::to_float(o.get("qty"));
        if let Some(u) = o.get("uuid").and_then(Value::as_str) {
            let book = if php::empty(o.get("food_item_id")) { &products } else { &variants };
            collect(book.get(u), qty);
        }
        for m in modifier_list(o.get("modifiers")) {
            // Only modifiers the customer actually picked consume stock.
            if let Some(checked) = m.get("is_checked") {
                if !php::filter_bool(checked) {
                    continue;
                }
            }
            if let Some(id) = m.get("id").and_then(crate::api::pos::common::fk_id) {
                collect(modifiers.get(&id), php::to_float(m.get("qty")));
            }
        }
    }
    Ok(usage)
}

fn modifier_list(v: Option<&Value>) -> Vec<&serde_json::Map<String, Value>> {
    match v {
        Some(Value::Array(a)) => a.iter().filter_map(Value::as_object).collect(),
        Some(Value::Object(o)) => o.values().filter_map(Value::as_object).collect(),
        _ => vec![],
    }
}

/// uuid -> [(ingredient id, quantity per unit)] for products or variants.
async fn recipes(conn: &mut MySqlConnection, table: &'static str, pivot_col: &'static str, uuids: &[String]) -> AppResult<HashMap<String, Vec<(i64, f64)>>> {
    let mut out: HashMap<String, Vec<(i64, f64)>> = HashMap::new();
    if uuids.is_empty() {
        return Ok(out);
    }
    let sql = format!(
        "SELECT t.id AS owner_id, t.uuid, p.ingredient_id, p.quantity FROM {table} t \
         JOIN food_items_ingredients p ON p.{pivot_col} = t.id JOIN ingredients i ON i.id = p.ingredient_id \
         WHERE t.uuid IN ({}) ORDER BY t.id, p.id",
        vec!["?"; uuids.len()].join(",")
    );
    let args: Vec<Arg> = uuids.iter().map(|u| Arg::Str(u.clone())).collect();
    let rows = bind_all(sqlx::query(&sql), &args).fetch_all(&mut *conn).await?;
    // A uuid shared by two records: like a first() lookup, use the first record's recipe.
    let mut owner: HashMap<String, i64> = HashMap::new();
    for r in rows_json(&rows) {
        let first = *owner.entry(r.str("uuid")).or_insert(r.i64("owner_id"));
        if first == r.i64("owner_id") {
            out.entry(r.str("uuid")).or_default().push((r.i64("ingredient_id"), r.f64("quantity")));
        }
    }
    Ok(out)
}

async fn modifier_recipes(conn: &mut MySqlConnection, ids: &[i64]) -> AppResult<HashMap<i64, Vec<(i64, f64)>>> {
    let mut out: HashMap<i64, Vec<(i64, f64)>> = HashMap::new();
    if ids.is_empty() {
        return Ok(out);
    }
    let sql = format!(
        "SELECT p.modifier_id, p.ingredient_id, p.quantity FROM ingredients_modifiers p JOIN ingredients i ON i.id = p.ingredient_id \
         WHERE p.modifier_id IN ({}) ORDER BY p.id",
        vec!["?"; ids.len()].join(",")
    );
    let args: Vec<Arg> = ids.iter().map(|i| Arg::Int(*i)).collect();
    let rows = bind_all(sqlx::query(&sql), &args).fetch_all(&mut *conn).await?;
    for r in rows_json(&rows) {
        out.entry(r.i64("modifier_id")).or_default().push((r.i64("ingredient_id"), r.f64("quantity")));
    }
    Ok(out)
}

/// Take the ingredients of `items` from stock (item consumption mode only).
pub async fn deduct(conn: &mut MySqlConnection, enabled: bool, items: &[Value], now: NaiveDateTime) -> AppResult<()> {
    if enabled {
        let usage = consumption(conn, items).await?;
        apply(conn, usage, '-', now).await?;
    }
    Ok(())
}

/// Put the ingredients of `items` back (item consumption mode only).
pub async fn restore(conn: &mut MySqlConnection, enabled: bool, items: &[Value], now: NaiveDateTime) -> AppResult<()> {
    if enabled {
        let usage = consumption(conn, items).await?;
        apply(conn, usage, '+', now).await?;
    }
    Ok(())
}

async fn apply(conn: &mut MySqlConnection, usage: BTreeMap<i64, f64>, op: char, now: NaiveDateTime) -> AppResult<()> {
    // Ascending ids: a stable lock order, so concurrent checkouts cannot deadlock.
    for (id, amount) in usage {
        if amount == 0.0 || !amount.is_finite() {
            continue;
        }
        // The amount is written as a decimal literal (not a bound double) so the
        // integer column rounds exactly as it always did. It is a number we
        // formatted ourselves: digits, sign, point and exponent only.
        let literal = php::float_string(amount);
        if !literal.chars().all(|c| c.is_ascii_digit() || matches!(c, '-' | '+' | '.' | 'E')) {
            continue;
        }
        let sql = format!("UPDATE ingredients SET quantity = quantity {op} ({literal}), updated_at = ? WHERE id = ?");
        tx_exec(conn, &sql, vec![now.into(), id.into()]).await?;
    }
    Ok(())
}
