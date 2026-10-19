//! Staff accounts (People > Users) and the user JSON shared by the account
//! and sign-in routes.

pub mod rules;

use crate::{
    auth::AuthUser,
    db::RowExt,
    error::{AppError, AppResult, Errors},
    input::Input,
    query::{paged, Sql},
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
        .route("/admin/users", get(index).post(store))
        .route("/admin/users/user/roles", get(user_roles))
        .route("/admin/users/{id}", get(show))
        .route("/admin/users/{id}", axum::routing::put(update).patch(update).delete(destroy).route_layer(demo()))
}

const PERM: &[&str] = &["manage_users"];

pub fn gravatar(email: &str) -> String {
    format!(
        "https://www.gravatar.com/avatar/{}?s=80&d=retro",
        rules::md5_hex(email.trim().to_lowercase().as_bytes())
    )
}

fn user_json(state: &AppState, s: &crate::settings::Settings, u: &Map<String, Value>, role: Value) -> Value {
    let avatar = match u.opt_str("avatar").filter(|a| !a.is_empty()) {
        Some(a) => state.storage_url(&a),
        None => "gravatar".to_string(),
    };
    json!({
        "id": u.val("id"),
        "name": u.val("name"),
        "email": u.val("email"),
        "phone": u.val("phone"),
        "address": u.val("address"),
        "company_address": null,
        "company_name": null,
        "avatar": avatar,
        "gravatar": gravatar(&u.str("email")),
        "role": role,
        "role_id": u.val("role_id"),
        "status": u.bool("status"),
        "created_at": s.fmt_value(&u.val("created_at")),
        "updated_at": s.fmt_value(&u.val("updated_at")),
    })
}

/// Users as JSON (never with password or tokens), roles loaded in one query.
pub async fn user_list(state: &AppState, rows: &[Map<String, Value>]) -> AppResult<Vec<Value>> {
    let s = state.settings.get().await;
    let mut role_ids: Vec<i64> = rows.iter().map(|r| r.i64("role_id")).collect();
    role_ids.sort_unstable();
    role_ids.dedup();
    let mut roles: HashMap<i64, Map<String, Value>> = HashMap::new();
    if !role_ids.is_empty() {
        let mut q = Sql::new("SELECT * FROM user_roles WHERE 1=1");
        q.and_in("id", role_ids.iter().copied());
        for r in q.fetch_all(&state.db).await? {
            roles.insert(r.i64("id"), r);
        }
    }
    let counts = super::roles::user_counts(state, &role_ids).await?;
    Ok(rows
        .iter()
        .map(|u| {
            let rid = u.i64("role_id");
            let role = roles
                .get(&rid)
                .map(|r| super::roles::role_json(&s, r, counts.get(&rid).copied().unwrap_or(0)))
                .unwrap_or(Value::Null);
            user_json(state, &s, u, role)
        })
        .collect())
}

pub async fn user_resource(state: &AppState, row: &Map<String, Value>) -> AppResult<Value> {
    Ok(user_list(state, std::slice::from_ref(row)).await?.pop().unwrap_or(Value::Null))
}

/// Fresh users row by id.
pub async fn load(state: &AppState, id: i64) -> AppResult<Map<String, Value>> {
    Sql::new("SELECT * FROM users WHERE id = ?").push_args("", [id]).fetch_optional(&state.db).await?.ok_or_else(AppError::not_found)
}

async fn find(state: &AppState, id: &str) -> AppResult<Map<String, Value>> {
    load(state, id.parse().map_err(|_| AppError::not_found())?).await
}

async fn index(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let s = state.settings.get().await;
    let mut q = Sql::new("SELECT * FROM users WHERE 1=1");
    if let Some(search) = input.opt_str("search") {
        let p = s.search_pattern(&search);
        q.push_args(" AND (name LIKE ? OR email LIKE ?)", [p.clone(), p]);
    }
    if let Some(role) = input.opt_str("role").or_else(|| input.opt_str("role_id")) {
        q.and("role_id = ?", role);
    }
    let (col, dir) = input.sort(
        &["id", "name", "email", "phone", "address", "status", "role_id", "email_verified_at", "created_at", "updated_at"],
        "created_at",
        "asc",
    );
    q.push(&format!(" ORDER BY `{col}` {dir}"));
    let (rows, p) = q.paginate(&state.db, input.page(10)).await?;
    Ok(Json(paged(user_list(&state, &rows).await?, p)))
}

async fn check_email(state: &AppState, input: &Input, e: &mut Errors, except: Option<i64>) -> AppResult<()> {
    match input.opt_str("email") {
        None => e.add("email", rules::required_msg("email")),
        Some(m) => {
            if !rules::is_email(&m) {
                e.add("email", rules::email_msg("email"));
            }
            if rules::len(&m) > 255 {
                e.add("email", rules::max_msg("email", 255));
            }
            if !e.has("email") && rules::taken(&state.db, "users", "email", &m, except).await? {
                e.add("email", rules::taken_msg("email"));
            }
        }
    }
    Ok(())
}

/// Checks of the create form (`except` = None) and the edit form, in the
/// field order of the previous API so the first message matches.
async fn check_fields(state: &AppState, input: &Input, except: Option<i64>) -> AppResult<()> {
    let mut e = Errors::default();
    match input.opt_str("name") {
        None => e.add("name", rules::required_msg("name")),
        Some(n) if rules::len(&n) > 255 => e.add("name", rules::max_msg("name", 255)),
        _ => {}
    }
    if except.is_some() {
        check_email(state, input, &mut e, except).await?;
    }
    match input.get("status") {
        None => e.add("status", rules::required_msg("status")),
        Some(v) if !rules::is_boolean(v) => e.add("status", "The status field must be true or false."),
        _ => {}
    }
    if except.is_none() {
        match input.str("password") {
            None => e.add("password", rules::required_msg("password")),
            Some(p) if rules::len(&p) < 6 => e.add("password", rules::min_msg("password", 6)),
            _ => {}
        }
    }
    match input.opt_str("role_id") {
        None => e.add("role_id", rules::required_msg("role_id")),
        Some(r) => {
            let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM user_roles WHERE id = ?").bind(&r).fetch_one(&state.db).await?;
            if n == 0 {
                e.add("role_id", rules::invalid_msg("role_id"));
            }
        }
    }
    if except.is_none() {
        check_email(state, input, &mut e, None).await?;
    }
    e.check()
}

async fn store(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    check_fields(&state, &input, None).await?;
    let name = input.string("name");
    let hash = crate::auth::hash_password(&input.str("password").unwrap_or_default())?;
    let now = state.settings.get().await.now();
    let res = sqlx::query(
        "INSERT INTO users (name, email, password, role_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&name)
    .bind(input.string("email"))
    .bind(&hash)
    .bind(input.string("role_id"))
    .bind(rules::bool_value(&input.val("status")))
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await?;
    crate::activity::log(&state, &user, &headers, &state.t("New user added successfully").await, Some(&name)).await;
    let row = load(&state, res.last_insert_id() as i64).await?;
    Ok(Json(json!({
        "message": state.t("Data saved successfully").await,
        "user": user_resource(&state, &row).await?,
    })))
}

async fn show(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let row = find(&state, &id).await?;
    if row.i64("id") == user.id {
        return Err(AppError::not_acceptable("Can not edit your user from the user manager"));
    }
    Ok(Json(user_resource(&state, &row).await?))
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
    check_fields(&state, &input, Some(id)).await?;
    let name = input.string("name");
    let now = state.settings.get().await.now();
    sqlx::query("UPDATE users SET name = ?, email = ?, status = ?, role_id = ?, updated_at = ? WHERE id = ?")
        .bind(&name)
        .bind(input.string("email"))
        .bind(rules::bool_value(&input.val("status")))
        .bind(input.string("role_id"))
        .bind(now)
        .bind(id)
        .execute(&state.db)
        .await?;
    crate::activity::log(&state, &user, &headers, &state.t("User updated successfully").await, Some(&name)).await;
    Ok(Json(json!({ "message": state.t("Data updated successfully").await })))
}

async fn destroy(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let row = find(&state, &id).await?;
    let id = row.i64("id");
    if id == user.id {
        return Err(AppError::not_acceptable("You can not delete your own user"));
    }
    let mut tx = state.db.begin().await?;
    let result: Result<(), sqlx::Error> = async {
        // The user's cash books go with the user, with the sales recorded in them
        sqlx::query("DELETE s FROM sales s JOIN cash_books c ON c.id = s.cash_book_id WHERE c.user_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM cash_books WHERE user_id = ?").bind(id).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM personal_access_tokens WHERE tokenable_type = ? AND tokenable_id = ?")
            .bind(crate::auth::TOKENABLE_USER)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM users WHERE id = ?").bind(id).execute(&mut *tx).await?;
        Ok(())
    }
    .await;
    match result {
        Ok(()) => tx.commit().await?,
        Err(err) => {
            let _ = tx.rollback().await;
            let fk = err.as_database_error().map(|d| matches!(d.kind(), sqlx::error::ErrorKind::ForeignKeyViolation)).unwrap_or(false);
            if fk {
                return Err(AppError::not_acceptable(
                    "This user has orders or expenses recorded and can not be removed. Deactivate the user instead.",
                ));
            }
            return Err(err.into());
        }
    }
    crate::activity::log(&state, &user, &headers, &state.t("User removed successfully").await, Some(&row.str("name"))).await;
    Ok(Json(json!({ "message": state.t("Data removed successfully").await })))
}

async fn user_roles(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let rows = Sql::new("SELECT * FROM user_roles").fetch_all(&state.db).await?;
    Ok(Json(Value::Array(super::roles::role_list(&state, &rows).await?)))
}
