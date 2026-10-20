//! Ingredients (stock items consumed by food items and modifiers), plus the
//! small validation and formatting helpers shared by the catalog modules
//! (food categories, food items, modifiers).

use crate::{
    activity,
    auth::AuthUser,
    db::RowExt,
    error::{AppError, AppResult, Errors},
    input::Input,
    query::{Arg, Sql},
    settings::Settings,
    state::AppState,
    util::json_num,
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    middleware::from_fn,
    routing::{delete, get},
    Json, Router,
};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/ingredients", get(index).post(store))
        .route("/admin/food-ingredients", get(list))
        .route("/admin/ingredients-rows-destroy", delete(destroy_batch))
        .route(
            "/admin/ingredients/{ingredient}",
            delete(destroy).route_layer(from_fn(crate::middleware::demo_mode)).get(show).put(update).patch(update),
        )
}

const PERM: &[&str] = &["manage_ingredients"];
const SORTABLE: &[&str] = &["id", "name", "price", "cost", "unit", "quantity", "alert_quantity", "description", "created_at", "updated_at"];

// ---------------------------------------------------------------------------
// Shared catalog helpers
// ---------------------------------------------------------------------------

/// A `double` column as the previous API printed it (50.0 -> 50, 12.5 -> 12.5).
pub(crate) fn dnum(row: &Map<String, Value>, key: &str) -> Value {
    match row.get(key) {
        None | Some(Value::Null) => Value::Null,
        Some(v) => json_num(crate::util::num(v)),
    }
}

/// PHP `is_numeric`: numbers, and strings holding a decimal or exponent number.
pub(crate) fn is_numeric(v: &Value) -> bool {
    match v {
        Value::Number(_) => true,
        Value::String(s) => numeric_str(s),
        _ => false,
    }
}

fn numeric_str(s: &str) -> bool {
    let t = s.trim_start_matches([' ', '\t', '\n', '\r', '\x0b', '\x0c']).trim_end_matches([' ', '\t', '\n', '\r', '\x0b', '\x0c']);
    let b = t.strip_prefix(['+', '-']).unwrap_or(t);
    if b.is_empty() {
        return false;
    }
    let (mantissa, exp) = match b.find(['e', 'E']) {
        Some(i) => (&b[..i], Some(&b[i + 1..])),
        None => (b, None),
    };
    let (int, frac) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    let digits = |x: &str| x.chars().all(|c| c.is_ascii_digit());
    if !digits(int) || !digits(frac) || (int.is_empty() && frac.is_empty()) {
        return false;
    }
    match exp {
        None => true,
        Some(e) => {
            let e = e.strip_prefix(['+', '-']).unwrap_or(e);
            !e.is_empty() && digits(e)
        }
    }
}

fn as_f64(v: &Value) -> f64 {
    crate::util::num(v)
}

/// the `required`: present, not null, not blank, not an empty array.
pub(crate) fn filled<'a>(input: &'a Input, key: &str) -> Option<&'a Value> {
    input.get(key).filter(|v| match v {
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
        Value::String(s) => !s.trim().is_empty(),
        _ => true,
    })
}

/// Field label the way validation messages name it ("food_category_id" -> "food category id").
fn label(field: &str) -> String {
    field.replace('_', " ")
}

pub(crate) fn require(errs: &mut Errors, input: &Input, field: &str) -> bool {
    if filled(input, field).is_none() {
        errs.add(field, format!("The {} field is required.", label(field)));
        false
    } else {
        true
    }
}

/// `cost`: required and a number (a non-numeric cost used to fail in the database).
pub(crate) fn check_cost(errs: &mut Errors, input: &Input) {
    if require(errs, input, "cost") && !input.get("cost").map(is_numeric).unwrap_or(false) {
        errs.add("cost", "The cost must be a number.");
    }
}

/// `price`: required|numeric|gte:cost with the custom message.
pub(crate) fn check_price(errs: &mut Errors, input: &Input) {
    let Some(price) = filled(input, "price") else {
        errs.add("price", "The price field is required.");
        return;
    };
    if !is_numeric(price) {
        errs.add("price", "The price must be a number.");
    }
    if !price_gte_cost(price, input.get("cost")) {
        errs.add("price", "Price must be equal or greater then cost");
    }
}

/// the `gte:cost` on a field that also has the `numeric` rule.
fn price_gte_cost(price: &Value, cost: Option<&Value>) -> bool {
    let Some(cost) = cost else { return false };
    if is_numeric(price) && is_numeric(cost) {
        return as_f64(price) >= as_f64(cost);
    }
    let kind = |v: &Value| match v {
        Value::Number(n) if n.is_f64() => 1,
        Value::Number(_) => 2,
        Value::String(_) => 3,
        Value::Bool(_) => 4,
        Value::Array(_) | Value::Object(_) => 5,
        Value::Null => 6,
    };
    if kind(price) != kind(cost) {
        return false;
    }
    let size = |v: &Value| match v {
        v if is_numeric(v) => as_f64(v),
        Value::Array(a) => a.len() as f64,
        Value::Object(o) => o.len() as f64,
        Value::String(s) => s.chars().count() as f64,
        _ => 0.0,
    };
    size(price) >= size(cost)
}

/// True when `value` is already used in `table.col` (other than row `except`).
pub(crate) async fn taken(state: &AppState, table: &str, col: &str, value: &Value, except: Option<i64>) -> AppResult<bool> {
    let mut q = Sql::new(format!("SELECT COUNT(*) AS c FROM {} WHERE {} = ?", crate::db::ident(table), crate::db::ident(col)));
    q.args.push(Arg::from(value));
    if let Some(id) = except {
        q.and("id <> ?", id);
    }
    Ok(q.scalar_f64(&state.db).await? > 0.0)
}

/// `rows` of a batch delete as a list (a single value counts as one row).
pub(crate) fn batch_rows(input: &Input) -> Vec<Value> {
    match input.get("rows") {
        Some(Value::Array(a)) => a.iter().filter(|v| !v.is_null()).cloned().collect(),
        Some(Value::Object(o)) => o.values().filter(|v| !v.is_null()).cloned().collect(),
        Some(v) => vec![v.clone()],
        None => vec![],
    }
}

/// Batch row values that are integer ids.
pub(crate) fn batch_ids(input: &Input) -> Vec<i64> {
    batch_rows(input)
        .iter()
        .filter_map(|v| match v {
            Value::Number(n) => n.as_i64(),
            Value::String(s) => s.trim().parse::<i64>().ok(),
            _ => None,
        })
        .collect()
}

/// PHP's string form of a stored value, used to tell whether an update
/// changes a column (only then is `updated_at` touched, like Eloquent).
pub(crate) fn php_string(v: &Value) -> Option<String> {
    match v {
        Value::Null => None,
        Value::String(s) => Some(s.clone()),
        Value::Bool(b) => Some(if *b { "1".into() } else { String::new() }),
        Value::Number(n) => Some(match (n.as_i64(), n.as_f64()) {
            (Some(i), _) => i.to_string(),
            (None, Some(f)) if f.fract() == 0.0 && f.abs() < 1e15 => format!("{}", f as i64),
            (None, Some(f)) => format!("{f}"),
            _ => n.to_string(),
        }),
        other => Some(other.to_string()),
    }
}

/// Whether setting `new` on a column that holds `old` makes the record dirty.
pub(crate) fn changes(old: &Value, new: &Value) -> bool {
    php_string(old) != php_string(new)
}

/// Ingredient row with its pivot quantity (`quantity_using`).
pub(crate) fn ingredient_with_pivot(s: &Settings, r: &Map<String, Value>) -> Value {
    let using = match r.get("pivot_quantity") {
        Some(Value::Null) | None => json!(0),
        Some(_) => dnum(r, "pivot_quantity"),
    };
    json!({
        "id": r.val("id"),
        "name": r.val("name"),
        "price": dnum(r, "price"),
        "cost": dnum(r, "cost"),
        "unit": r.val("unit"),
        "alert_quantity": r.val("alert_quantity"),
        "quantity": r.val("quantity"),
        "quantity_using": using,
        "created_at": s.fmt_value(&r.val("created_at")),
        "updated_at": s.fmt_value(&r.val("updated_at")),
    })
}

/// Ingredients consumption rows sent by the forms: `[{id, quantity_using}]`.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Consumption {
    pub id: i64,
    pub quantity: f64,
}

/// Parse a consumption list; `None` when an entry has no usable id.
pub(crate) fn parse_consumption(v: &Value) -> Option<Vec<Consumption>> {
    let items: Vec<&Value> = match v {
        Value::Array(a) => a.iter().collect(),
        Value::Object(o) => o.values().collect(),
        Value::Null => vec![],
        _ => return None,
    };
    items
        .into_iter()
        .map(|it| {
            let o = it.as_object()?;
            let id = match o.get("id")? {
                Value::Number(n) => n.as_i64().or_else(|| n.as_f64().filter(|f| f.fract() == 0.0).map(|f| f as i64)),
                Value::String(s) => s.trim().parse::<i64>().ok(),
                _ => None,
            }?;
            let quantity = o.get("quantity_using").map(crate::util::num).unwrap_or(0.0);
            Some(Consumption { id, quantity })
        })
        .collect()
}

/// Ids among `ids` that are not ingredients.
pub(crate) async fn unknown_ingredients(state: &AppState, ids: &[i64]) -> AppResult<bool> {
    let wanted: HashSet<i64> = ids.iter().copied().collect();
    if wanted.is_empty() {
        return Ok(false);
    }
    let mut q = Sql::new("SELECT id FROM ingredients WHERE 1=1");
    q.and_in("id", wanted.iter().copied());
    let found: HashSet<i64> = q.fetch_all(&state.db).await?.iter().map(|r| r.i64("id")).collect();
    Ok(wanted.iter().any(|id| !found.contains(id)))
}

/// Log an activity in the app language.
pub(crate) async fn log(state: &AppState, user: &AuthUser, headers: &HeaderMap, key: &str, link: Option<&str>) {
    let text = state.t(key).await;
    activity::log(state, user, headers, &text, link).await;
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

/// ids of the given ingredients that are used by a food item or a modifier.
async fn used_ids(state: &AppState, ids: &[i64]) -> AppResult<HashSet<i64>> {
    if ids.is_empty() {
        return Ok(HashSet::new());
    }
    let mut a = Sql::new(
        "SELECT DISTINCT p.ingredient_id AS id FROM food_items_ingredients p INNER JOIN food_items f ON f.id = p.food_item_id WHERE 1=1",
    );
    a.and_in("p.ingredient_id", ids.iter().copied());
    let mut b = Sql::new(
        "SELECT DISTINCT p.ingredient_id AS id FROM ingredients_modifiers p INNER JOIN modifiers m ON m.id = p.modifier_id WHERE 1=1",
    );
    b.and_in("p.ingredient_id", ids.iter().copied());
    let mut used: HashSet<i64> = a.fetch_all(&state.db).await?.iter().map(|r| r.i64("id")).collect();
    used.extend(b.fetch_all(&state.db).await?.iter().map(|r| r.i64("id")));
    Ok(used)
}

async fn resources(state: &AppState, rows: &[Map<String, Value>]) -> AppResult<Vec<Value>> {
    let s = state.settings.get().await;
    let ids: Vec<i64> = rows.iter().map(|r| r.i64("id")).collect();
    let used = used_ids(state, &ids).await?;
    Ok(rows
        .iter()
        .map(|r| {
            json!({
                "id": r.val("id"),
                "name": r.val("name"),
                "price": dnum(r, "price"),
                "cost": dnum(r, "cost"),
                "unit": r.val("unit"),
                "alert_quantity": r.val("alert_quantity"),
                "quantity": r.val("quantity"),
                "is_being_used": used.contains(&r.i64("id")),
                "created_at": s.fmt_value(&r.val("created_at")),
                "updated_at": s.fmt_value(&r.val("updated_at")),
            })
        })
        .collect())
}

async fn find(state: &AppState, id: &str) -> AppResult<Map<String, Value>> {
    let Ok(id) = id.parse::<i64>() else { return Err(AppError::not_found()) };
    Sql::new("SELECT * FROM ingredients WHERE id = ?").push_args("", [id]).fetch_optional(&state.db).await?.ok_or_else(AppError::not_found)
}

async fn index(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let s = state.settings.get().await;
    let mut q = Sql::new("SELECT * FROM ingredients WHERE 1=1");
    if let Some(term) = input.str("search") {
        q.and("name LIKE ?", s.search_pattern(&term));
    }
    let (col, dir) = input.sort(SORTABLE, "created_at", "asc");
    q.push(&format!(" ORDER BY {} {dir}", crate::db::ident(&col)));
    let (rows, p) = q.paginate(&state.db, input.page(10)).await?;
    Ok(Json(crate::query::paged(resources(&state, &rows).await?, p)))
}

async fn list(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(&["manage_ingredients", "manage_food_items", "manage_modifiers"])?;
    let rows = Sql::new("SELECT * FROM ingredients").fetch_all(&state.db).await?;
    Ok(Json(Value::Array(resources(&state, &rows).await?)))
}

async fn show(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let row = find(&state, &id).await?;
    let mut out = resources(&state, &[row]).await?;
    Ok(Json(out.pop().unwrap_or(Value::Null)))
}

/// Validated ingredient fields in rule order.
async fn validate(state: &AppState, input: &Input, except: Option<i64>) -> AppResult<()> {
    let mut errs = Errors::default();
    if require(&mut errs, input, "name") && taken(state, "ingredients", "name", &input.val("name"), except).await? {
        errs.add("name", "The name has already been taken.");
    }
    check_price(&mut errs, input);
    check_cost(&mut errs, input);
    if require(&mut errs, input, "quantity") && !input.get("quantity").map(is_numeric).unwrap_or(false) {
        errs.add("quantity", "The quantity must be a number.");
    }
    require(&mut errs, input, "alert_quantity");
    require(&mut errs, input, "unit");
    errs.check()
}

/// Stock quantity column is an integer.
fn quantity(input: &Input) -> i64 {
    crate::util::round(input.get("quantity").map(crate::util::num).unwrap_or(0.0), 0) as i64
}

async fn store(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    validate(&state, &input, None).await?;
    let now = state.settings.get().await.now();
    let res = sqlx::query(
        "INSERT INTO ingredients (name, price, cost, quantity, alert_quantity, unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(input.string("name"))
    .bind(input.f64("price").unwrap_or(0.0))
    .bind(input.f64("cost").unwrap_or(0.0))
    .bind(quantity(&input))
    .bind(input.str("alert_quantity").unwrap_or_default())
    .bind(input.str("unit").unwrap_or_default())
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await?;
    log(&state, &user, &headers, tr!("New ingredient added successfully"), None).await;
    Ok(Json(json!({
        "message": state.t("Data saved successfully").await,
        "ingredient": res.last_insert_id(),
    })))
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
    input: Input,
) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let row = find(&state, &id).await?;
    let id = row.i64("id");
    validate(&state, &input, Some(id)).await?;
    let new = [
        ("name", input.val("name")),
        ("price", input.val("price")),
        ("cost", input.val("cost")),
        ("quantity", input.val("quantity")),
        ("alert_quantity", input.val("alert_quantity")),
        ("unit", input.val("unit")),
    ];
    if new.iter().any(|(k, v)| changes(&row.val(k), v)) {
        let now = state.settings.get().await.now();
        sqlx::query(
            "UPDATE ingredients SET name = ?, price = ?, cost = ?, quantity = ?, alert_quantity = ?, unit = ?, updated_at = ? WHERE id = ?",
        )
        .bind(input.string("name"))
        .bind(input.f64("price").unwrap_or(0.0))
        .bind(input.f64("cost").unwrap_or(0.0))
        .bind(quantity(&input))
        .bind(input.str("alert_quantity").unwrap_or_default())
        .bind(input.str("unit").unwrap_or_default())
        .bind(now)
        .bind(id)
        .execute(&state.db)
        .await?;
    }
    log(&state, &user, &headers, tr!("Ingredient updated successfully"), None).await;
    Ok(Json(json!({ "message": state.t("Data updated successfully").await })))
}

async fn destroy(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let row = find(&state, &id).await?;
    let id = row.i64("id");
    if !used_ids(&state, &[id]).await?.is_empty() {
        return Err(AppError::unprocessable("This ingredient is being used for food items or modifiers"));
    }
    sqlx::query("DELETE FROM ingredients WHERE id = ?").bind(id).execute(&state.db).await?;
    log(&state, &user, &headers, tr!("Ingredient removed successfully"), None).await;
    Ok(Json(json!({ "message": state.t("Data removed successfully").await })))
}

async fn destroy_batch(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let mut q = Sql::new("SELECT id FROM ingredients WHERE 1=1");
    q.and_in("id", batch_ids(&input));
    let ids: Vec<i64> = q.fetch_all(&state.db).await?.iter().map(|r| r.i64("id")).collect();
    let used = used_ids(&state, &ids).await?;
    let remove: Vec<i64> = ids.iter().copied().filter(|id| !used.contains(id)).collect();
    let skipped = ids.len() - remove.len();
    if !remove.is_empty() {
        let mut tx = state.db.begin().await?;
        let mut d = Sql::new("DELETE FROM ingredients WHERE 1=1");
        d.and_in("id", remove.iter().copied());
        crate::query::bind_all(sqlx::query(&d.text), &d.args).execute(&mut *tx).await?;
        tx.commit().await?;
    }
    for _ in &remove {
        log(&state, &user, &headers, tr!("Ingredient removed successfully"), None).await;
    }
    let message = if skipped > 0 {
        let n = skipped.to_string();
        state.tp(":count ingredient(s) are used by food items or modifiers and were kept", &[("count", &n)]).await
    } else {
        state.t("Data removed successfully").await
    };
    Ok(Json(json!({ "message": message, "skipped": skipped })))
}

/// Ingredient rows (with pivot quantity) for a pivot table, grouped by `key`.
/// `sql` selects `ingredients.*`, `pivot_quantity` and `pivot_key`.
pub(crate) async fn pivot_groups(state: &AppState, q: &Sql) -> AppResult<HashMap<i64, Vec<Value>>> {
    let s = state.settings.get().await;
    let mut out: HashMap<i64, Vec<Value>> = HashMap::new();
    for r in q.fetch_all(&state.db).await? {
        out.entry(r.i64("pivot_key")).or_default().push(ingredient_with_pivot(&s, &r));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numeric_like_php() {
        for ok in ["1", "1.5", ".5", "5.", "-3", "+2", "1e3", "1.2E-4", " 7"] {
            assert!(numeric_str(ok), "{ok}");
        }
        for bad in ["", "abc", "1a", "e5", ".", "1e", "inf", "NaN", "0x1A", "1 2"] {
            assert!(!numeric_str(bad), "{bad}");
        }
    }

    #[test]
    fn gte_rules() {
        assert!(price_gte_cost(&json!("10"), Some(&json!("9"))));
        assert!(!price_gte_cost(&json!("9"), Some(&json!("10"))));
        assert!(!price_gte_cost(&json!("9"), None));
        // non-numeric strings compare by length, like the earlier size rules
        assert!(price_gte_cost(&json!("abcd"), Some(&json!("abc"))));
        assert!(!price_gte_cost(&json!(5), Some(&json!("abc"))));
    }

    #[test]
    fn dirty_compare() {
        assert!(!changes(&json!(50.0), &json!("50")));
        assert!(changes(&json!(50.0), &json!("50.00")));
        assert!(!changes(&json!(12.5), &json!("12.5")));
        assert!(!changes(&json!(3), &json!("3")));
        assert!(changes(&Value::Null, &json!("x")));
        assert!(!changes(&Value::Null, &Value::Null));
    }

    #[test]
    fn consumption_rows() {
        let v = json!([{"id": 3, "quantity_using": "1.5"}, {"id": "4"}]);
        assert_eq!(parse_consumption(&v), Some(vec![Consumption { id: 3, quantity: 1.5 }, Consumption { id: 4, quantity: 0.0 }]));
        assert_eq!(parse_consumption(&json!([{"name": "x"}])), None);
        assert_eq!(parse_consumption(&json!("x")), None);
    }
}
