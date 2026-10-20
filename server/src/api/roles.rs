//! User roles and their permission keys (People > User roles).

use crate::{
    api::users::rules,
    auth::AuthUser,
    db::RowExt,
    error::{AppError, AppResult, Errors},
    input::Input,
    query::{paged, Sql},
    settings::Settings,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::get,
    Json, Router,
};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

pub fn router() -> Router<AppState> {
    let demo = || axum::middleware::from_fn(crate::middleware::demo_mode);
    Router::new()
        .route("/admin/roles/permissions", get(permissions))
        .route("/admin/user-roles", get(index).post(store))
        .route("/admin/user-roles/{id}", get(show))
        .route("/admin/user-roles/{id}", axum::routing::put(update).patch(update).delete(destroy).route_layer(demo()))
}

const PERM: &[&str] = &["manage_user_roles"];

/// `permissions` column (JSON text) as a JSON value, like the model cast.
pub fn decode(v: &Value) -> Value {
    match v {
        Value::String(s) => serde_json::from_str(s).unwrap_or(Value::Null),
        Value::Null => Value::Null,
        other => other.clone(),
    }
}

/// Role as listed (with its number of users).
pub fn role_json(s: &Settings, r: &Map<String, Value>, users: i64) -> Value {
    json!({
        "id": r.val("id"),
        "name": r.val("name"),
        "is_primary": r.bool("is_primary"),
        "users": users,
        "permissions": decode(&r.val("permissions")),
        "admin_access": null,
        "ordertaking_access": null,
        "kitchendisplay_access": null,
        "billingdisplay_access": null,
        "created_at": s.fmt_value(&r.val("created_at")),
        "updated_at": s.fmt_value(&r.val("updated_at")),
    })
}

/// Role for the edit form.
fn role_edit_json(s: &Settings, r: &Map<String, Value>) -> Value {
    json!({
        "id": r.val("id"),
        "name": r.val("name"),
        "type": null,
        "admin_access": null,
        "ordertaking_access": null,
        "kitchendisplay_access": null,
        "billingdisplay_access": null,
        "permissions": decode(&r.val("permissions")),
        "created_at": s.fmt_value(&r.val("created_at")),
        "updated_at": s.fmt_value(&r.val("updated_at")),
    })
}

/// Number of users per role id, in one query.
pub async fn user_counts(state: &AppState, ids: &[i64]) -> AppResult<HashMap<i64, i64>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let mut q = Sql::new("SELECT role_id, COUNT(*) AS c FROM users WHERE 1=1");
    q.and_in("role_id", ids.iter().copied());
    q.push(" GROUP BY role_id");
    Ok(q.fetch_all(&state.db).await?.iter().map(|r| (r.i64("role_id"), r.i64("c"))).collect())
}

/// Listed roles with their user counts.
pub async fn role_list(state: &AppState, rows: &[Map<String, Value>]) -> AppResult<Vec<Value>> {
    let s = state.settings.get().await;
    let ids: Vec<i64> = rows.iter().map(|r| r.i64("id")).collect();
    let counts = user_counts(state, &ids).await?;
    Ok(rows.iter().map(|r| role_json(&s, r, counts.get(&r.i64("id")).copied().unwrap_or(0))).collect())
}

async fn find(state: &AppState, id: &str) -> AppResult<Map<String, Value>> {
    let id: i64 = id.parse().map_err(|_| AppError::not_found())?;
    Sql::new("SELECT * FROM user_roles WHERE id = ?").push_args("", [id]).fetch_optional(&state.db).await?.ok_or_else(AppError::not_found)
}

async fn index(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let s = state.settings.get().await;
    let mut q = Sql::new("SELECT * FROM user_roles WHERE 1=1");
    if let Some(search) = input.opt_str("search") {
        q.and("name LIKE ?", s.search_pattern(&search));
    }
    let (col, dir) = input.sort(&["id", "name", "is_primary", "permissions", "created_at", "updated_at"], "created_at", "asc");
    q.push(&format!(" ORDER BY `{col}` {dir}"));
    let (rows, p) = q.paginate(&state.db, input.page(10)).await?;
    Ok(Json(paged(role_list(&state, &rows).await?, p)))
}

/// Non-empty permission keys from the request (empty values are dropped).
fn permissions_input(input: &Input) -> Vec<Value> {
    let list: Vec<Value> = match input.json("permissions") {
        Some(Value::Array(a)) => a,
        Some(Value::Object(o)) => o.into_iter().map(|(_, v)| v).collect(),
        _ => vec![],
    };
    list.into_iter().filter(|v| !v.is_null() && v != &json!(false) && v != &json!("0") && v != &json!(0) && v != &json!("")).collect()
}

async fn validate(state: &AppState, input: &Input, except: Option<i64>) -> AppResult<String> {
    let mut e = Errors::default();
    let name = input.opt_str("name");
    match &name {
        None => e.add("name", rules::required_msg("name")),
        Some(n) => {
            if rules::len(n) > 255 {
                e.add("name", rules::max_msg("name", 255));
            }
            if !e.has("name") && rules::taken(&state.db, "user_roles", "name", n, except).await? {
                e.add("name", rules::taken_msg("name"));
            }
        }
    }
    e.check()?;
    Ok(name.unwrap_or_default())
}

async fn store(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let name = validate(&state, &input, None).await?;
    let perms = Value::Array(permissions_input(&input)).to_string();
    let now = state.settings.get().await.now();
    let res = sqlx::query("INSERT INTO user_roles (name, permissions, created_at, updated_at) VALUES (?, ?, ?, ?)")
        .bind(&name)
        .bind(&perms)
        .bind(now)
        .bind(now)
        .execute(&state.db)
        .await?;
    crate::activity::log(&state, &user, &headers, &state.t("New user role added successfully").await, None).await;
    let row = find(&state, &res.last_insert_id().to_string()).await?;
    let s = state.settings.get().await;
    Ok(Json(json!({
        "message": state.t("Data saved successfully").await,
        "userRole": role_edit_json(&s, &row),
    })))
}

async fn show(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let row = find(&state, &id).await?;
    if row.bool("is_primary") {
        return Err(AppError::not_acceptable("Cannot edit a system base function"));
    }
    let s = state.settings.get().await;
    Ok(Json(role_edit_json(&s, &row)))
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
    let name = validate(&state, &input, Some(id)).await?;
    if row.bool("is_primary") {
        return Err(AppError::not_acceptable("Cannot edit a system base function"));
    }
    let perms = Value::Array(permissions_input(&input)).to_string();
    let now = state.settings.get().await.now();
    sqlx::query("UPDATE user_roles SET name = ?, permissions = ?, updated_at = ? WHERE id = ?")
        .bind(&name)
        .bind(&perms)
        .bind(now)
        .bind(id)
        .execute(&state.db)
        .await?;
    crate::activity::log(&state, &user, &headers, &state.t("User role updated successfully").await, None).await;
    Ok(Json(json!({ "message": state.t("Data updated successfully").await })))
}

async fn destroy(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let row = find(&state, &id).await?;
    let id = row.i64("id");
    let s = state.settings.get().await;
    let default_role = s.str("app_default_role").trim().parse::<i64>().ok();
    if row.bool("is_primary") || default_role == Some(id) {
        return Err(AppError::not_acceptable("Can not delete a default role"));
    }
    let now = s.now();
    let mut tx = state.db.begin().await?;
    sqlx::query("UPDATE users SET role_id = ?, updated_at = ? WHERE role_id = ?")
        .bind(default_role)
        .bind(now)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM user_roles WHERE id = ?").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    crate::activity::log(&state, &user, &headers, &state.t("User role removed successfully").await, None).await;
    Ok(Json(json!({ "message": state.t("Data removed successfully").await })))
}

/// Permission keys with their labels, grouped under titles, for the role form.
async fn permissions(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    // (key, label); an empty key is a group title
    const LIST: &[(&str, &str)] = &[
        ("dashboard_access", tr!("Dashboard access")),
        ("manage_sales", tr!("Manage sales")),
        ("remove_sales", tr!("Remove sale order")),
        ("manage_reservations", tr!("Manage room reservations")),
        ("manage_reservations_remove", tr!("Remove room reservations")),
        ("", tr!("Portal area")),
        ("pos_portal", tr!("POS portal")),
        ("order_checkout", tr!("Allow to process billing in POS portal")),
        ("apply_discount", tr!("Allow to apply discounts and change prices in POS portal")),
        ("kitchen_portal", tr!("Kitchen portal")),
        ("", tr!("Food area")),
        ("manage_food_categories", tr!("Manage food category")),
        ("manage_food_items", tr!("Manage food items")),
        ("manage_modifiers", tr!("Manage modifiers")),
        ("manage_ingredients", tr!("Manage ingredients")),
        ("", tr!("Expense area")),
        ("manage_expense_types", tr!("Manage expense types")),
        ("manage_expenses", tr!("Manage expenses")),
        ("", tr!("People area")),
        ("manage_users", tr!("Manage users")),
        ("manage_user_roles", tr!("Manage user roles")),
        ("manage_customers", tr!("Manage customers roles")),
        ("", tr!("Reports area")),
        ("stock_alerts", tr!("Stock alerts")),
        ("expiry_alerts", tr!("Expiry alerts")),
        ("overall_sale_report", tr!("Overall sale report")),
        ("overall_expense_report", tr!("Overall expense report")),
        ("most_sold_items_report", tr!("Most sold items report")),
        ("cashbooks_report", tr!("Cashbooks report")),
        ("tax_report", tr!("Tax report")),
        ("expense_report", tr!("Expense report")),
        ("category_based_report", tr!("Category based report")),
        ("", tr!("Advance area")),
        ("import_exports", tr!("Import and exports")),
        ("manage_service_tables", tr!("Manage service tables")),
        ("manage_guest_rooms", tr!("Manage guest rooms")),
        ("manage_payment_methods", tr!("Manage payment methods")),
        ("manage_reservation_statuses", tr!("Manage reservation statuses")),
        ("manage_booking_sources", tr!("Manage booking sources")),
        ("manage_pickup_points", tr!("Manage pickup points")),
        ("activity_logs", tr!("Activity logs")),
        ("database_backup", tr!("Database backup")),
        ("manage_languages", tr!("Manage Languages")),
        ("", tr!("Configuration area")),
        ("general_configuration", tr!("General configuration")),
        ("appearance_configuration", tr!("Appearance configuration")),
        ("localization_configuration", tr!("Localization configuration")),
        ("authentication_configuration", tr!("Authentication configuration")),
        ("outgoing_mail_configuration", tr!("Outgoing mail configuration")),
        ("captcha_configuration", tr!("Captcha configuration")),
        ("currency_configuration", tr!("Currency configuration")),
        ("tax_configuration", tr!("Tax configuration")),
        ("printer_configuration", tr!("Printer configuration")),
        ("advance_configuration", tr!("Advance configuration")),
        ("sms_configuration", tr!("SMS API configuration")),
        ("whatsapp_configuration", tr!("WhatsApp API configuration")),
        ("notification_templates", tr!("Notification templates")),
    ];
    let s = state.settings.get().await;
    let locale = s.opt_str("app_locale").unwrap_or_else(|| "en".into());
    let mut out = Vec::with_capacity(LIST.len());
    for (key, label) in LIST {
        let label = state.lang.t(&locale, label, &[]).await;
        out.push(if key.is_empty() { json!({ "title": true, "label": label }) } else { json!({ "key": key, "label": label }) });
    }
    Ok(Json(Value::Array(out)))
}
