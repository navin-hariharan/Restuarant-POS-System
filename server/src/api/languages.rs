//! Settings > Languages: add languages, translate their strings and keep
//! every translation file in step with the English strings of this release.

use crate::{
    api::{locale::language_json, users::rules},
    auth::AuthUser,
    db::RowExt,
    error::{AppError, AppResult, Errors},
    i18n::Lang,
    input::Input,
    query::Sql,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Map, Value};

pub fn router() -> Router<AppState> {
    let demo = || axum::middleware::from_fn(crate::middleware::demo_mode);
    Router::new()
        .route("/admin/languages", get(index).post(store))
        .route("/admin/languages/sync", post(sync))
        .route("/admin/languages/{id}", get(show).put(update).patch(update))
        .route("/admin/languages/{id}", axum::routing::delete(destroy).route_layer(demo()))
}

const PERM: &[&str] = &["manage_languages"];

async fn find(state: &AppState, id: &str) -> AppResult<Map<String, Value>> {
    let id: i64 = id.parse().map_err(|_| AppError::not_found())?;
    Sql::new("SELECT * FROM languages WHERE id = ?").push_args("", [id]).fetch_optional(&state.db).await?.ok_or_else(AppError::not_found)
}

/// The first language row is the source language and can not be changed.
fn is_prime(r: &Map<String, Value>) -> bool {
    r.i64("id") == 1
}

/// Add the shipped English strings missing from `current` (English text for
/// new strings until someone translates them). Returns true when it changed.
fn merge_shipped(locale: &str, current: &mut Map<String, Value>, shipped: &Map<String, Value>) -> bool {
    let before = current.len();
    for (k, v) in shipped {
        if !current.contains_key(k) {
            current.insert(k.clone(), if locale == "en" { v.clone() } else { Value::from(k.clone()) });
        }
    }
    current.len() != before
}

/// Create or complete the translation file of `locale`.
async fn sync_file(state: &AppState, locale: &str, shipped: &Map<String, Value>) -> AppResult<()> {
    if !Lang::valid_locale(locale) {
        return Ok(());
    }
    let mut current = if state.lang.exists(locale).await {
        let path = state.lang.path(locale).ok_or_else(AppError::not_found)?;
        match tokio::fs::read_to_string(&path).await.ok().and_then(|t| serde_json::from_str::<Map<String, Value>>(&t).ok()) {
            Some(m) => m,
            // Leave a damaged file alone rather than replacing someone's work
            None => return Ok(()),
        }
    } else {
        Map::new()
    };
    let missing_file = current.is_empty();
    if merge_shipped(locale, &mut current, shipped) || missing_file {
        state.lang.write(locale, &current).await?;
    }
    Ok(())
}

async fn index(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    Ok(Json(Value::Array(crate::api::locale::all_languages(&state).await?)))
}

async fn store(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let mut e = Errors::default();
    match input.opt_str("name") {
        None => e.add("name", rules::required_msg("name")),
        Some(n) if rules::len(&n) > 50 => e.add("name", "The name may not be greater than 50 characters."),
        _ => {}
    }
    match input.opt_str("locale") {
        None => e.add("locale", rules::required_msg("locale")),
        Some(l) => {
            if rules::len(&l) > 5 {
                e.add("locale", "The locale may not be greater than 5 characters.");
            }
            // Used as a file name: letters, digits, - and _ only
            if !Lang::valid_locale(&l) {
                e.add("locale", "The locale format is invalid.");
            }
            if !e.has("locale") && rules::taken(&state.db, "languages", "locale", &l, None).await? {
                e.add("locale", rules::taken_msg("locale"));
            }
        }
    }
    if !input.has("direction") {
        e.add("direction", rules::required_msg("direction"));
    }
    e.check()?;
    let locale = input.string("locale");
    let res = sqlx::query("INSERT INTO languages (name, locale, direction) VALUES (?, ?, ?)")
        .bind(input.string("name"))
        .bind(&locale)
        .bind(input.string("direction"))
        .execute(&state.db)
        .await?;
    sync_file(&state, &locale, &Lang::default_en()).await?;
    crate::activity::log(&state, &user, &headers, &state.t("New translation added successfully").await, None).await;
    let row = find(&state, &res.last_insert_id().to_string()).await?;
    Ok(Json(json!({
        "message": state.t("Data saved successfully").await,
        "language": language_json(&row),
    })))
}

async fn show(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let row = find(&state, &id).await?;
    let locale = row.str("locale");
    if !state.lang.exists(&locale).await {
        return Err(AppError::Status(StatusCode::INTERNAL_SERVER_ERROR, tr!("No translations found for the selected language").into()));
    }
    let map = state.lang.get(&locale).await;
    let translations: Vec<Value> = map.iter().map(|(k, v)| json!({ "key": k, "value": v })).collect();
    Ok(Json(json!({ "language": language_json(&row), "translations": translations })))
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
    let strings = match input.get("strings") {
        None => vec![],
        Some(Value::Array(a)) => a.clone(),
        Some(Value::Object(o)) => o.values().cloned().collect(),
        Some(_) => return Err(AppError::field("strings", "The strings must be an array")),
    };
    if is_prime(&row) {
        return Err(AppError::not_acceptable("Can't update english language,please create new language for localization"));
    }
    let locale = row.str("locale");
    if !state.lang.exists(&locale).await {
        return Err(AppError::Status(StatusCode::INTERNAL_SERVER_ERROR, tr!("Something went wrong try again !").into()));
    }
    let mut map = (*state.lang.get(&locale).await).clone();
    for s in &strings {
        let Some(key) = s.get("key").and_then(|k| match k {
            Value::String(s) => Some(s.clone()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        }) else {
            continue;
        };
        if key.is_empty() {
            continue;
        }
        let value = match s.get("value") {
            None | Some(Value::Null) => Value::Null,
            Some(Value::String(v)) => Value::from(v.clone()),
            Some(Value::Number(n)) => Value::from(n.to_string()),
            Some(Value::Bool(b)) => Value::from(if *b { "1" } else { "" }),
            Some(other) => Value::from(other.to_string()),
        };
        map.insert(key, value);
    }
    if let Err(err) = state.lang.write(&locale, &map).await {
        tracing::error!(error = %err, "could not save translations");
        return Err(AppError::Status(StatusCode::INTERNAL_SERVER_ERROR, tr!("Something went wrong try again !").into()));
    }
    crate::activity::log(&state, &user, &headers, &state.t("Translation updated successfully").await, None).await;
    Ok(Json(json!({
        "message": state.t("Data updated successfully").await,
        "language": language_json(&row),
    })))
}

async fn destroy(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let row = find(&state, &id).await?;
    let locale = row.str("locale");
    let current = state.settings.get().await.opt_str("app_locale").unwrap_or_else(|| "en".into());
    // English is the base every other language falls back to
    if is_prime(&row) || locale == current || locale == "en" {
        return Err(AppError::not_acceptable("Can't delete default language"));
    }
    sqlx::query("DELETE FROM languages WHERE id = ?").bind(row.i64("id")).execute(&state.db).await?;
    // Only remove the file when no other row (same code, other case) still uses it
    let others: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM languages WHERE locale = ?").bind(&locale).fetch_one(&state.db).await?;
    if others == 0 {
        state.lang.delete(&locale).await?;
    }
    Ok(Json(json!({ "message": state.t("Data removed successfully").await })))
}

/// Bring every language file up to date with the strings of this release.
async fn sync(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let shipped = Lang::default_en();
    let rows = Sql::new("SELECT locale FROM languages ORDER BY id").fetch_all(&state.db).await?;
    let mut output = String::new();
    for r in &rows {
        let locale = r.str("locale");
        if !Lang::valid_locale(&locale) {
            continue;
        }
        sync_file(&state, &locale, &shipped).await?;
        output = format!("Translatable strings have been extracted and written to the {locale}.json file.\n");
    }
    Ok(Json(json!({
        "message": state.t("Translation files updated correctly").await,
        "output": output,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_keeps_translations() {
        let shipped: Map<String, Value> = serde_json::from_str(r#"{"Save":"Save","New":"New"}"#).unwrap();
        let mut fr: Map<String, Value> = serde_json::from_str(r#"{"Save":"Enregistrer"}"#).unwrap();
        assert!(merge_shipped("fr", &mut fr, &shipped));
        assert_eq!(fr["Save"], "Enregistrer");
        assert_eq!(fr["New"], "New");
        assert!(!merge_shipped("fr", &mut fr, &shipped));
    }
}
