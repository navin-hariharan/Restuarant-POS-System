//! Public language list, translation files for the web app, and switching
//! the app language.

use crate::{
    auth::AuthUser,
    db::RowExt,
    error::{AppError, AppResult, Errors},
    input::Input,
    query::Sql,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Map, Value};

pub fn router() -> Router<AppState> {
    Router::new().route("/lang", get(list)).route("/lang/{lang}", get(translations)).route("/lang/set-language", post(set_language))
}

pub fn language_json(r: &Map<String, Value>) -> Value {
    json!({
        "id": r.val("id"),
        "locale": r.val("locale"),
        "name": r.val("name"),
        "direction": r.val("direction"),
    })
}

pub async fn all_languages(state: &AppState) -> AppResult<Vec<Value>> {
    let rows = Sql::new("SELECT * FROM languages ORDER BY id").fetch_all(&state.db).await?;
    Ok(rows.iter().map(language_json).collect())
}

async fn list(State(state): State<AppState>) -> AppResult<Json<Value>> {
    Ok(Json(Value::Array(all_languages(&state).await?)))
}

async fn translations(State(state): State<AppState>, Path(lang): Path<String>) -> AppResult<Json<Value>> {
    let missing = || AppError::Status(axum::http::StatusCode::NOT_FOUND, tr!("The selected language does not exist").into());
    let row = Sql::new("SELECT locale FROM languages WHERE locale = ? LIMIT 1").push_args("", [lang]).fetch_optional(&state.db).await?;
    let Some(row) = row else { return Err(missing()) };
    let locale = row.str("locale");
    if !state.lang.exists(&locale).await {
        return Err(missing());
    }
    let map = state.lang.get(&locale).await;
    Ok(Json(Value::Object((*map).clone())))
}

async fn set_language(State(state): State<AppState>, _user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    let mut e = Errors::default();
    for f in ["id", "locale", "direction"] {
        if !input.has(f) {
            e.add(f, format!("The {f} field is required."));
        }
    }
    e.check()?;
    let locale = input.string("locale");
    let direction = input.string("direction");
    if locale.chars().count() > 191 || direction.chars().count() > 191 {
        return Err(AppError::field("locale", "The locale may not be greater than 191 characters."));
    }
    // The message is in the language that was active when the request came in
    let message = state.t("Language has been changed").await;
    let now = state.settings.get().await.now();
    sqlx::query("UPDATE settings SET app_locale = ?, app_direction = ?, updated_at = ? WHERE id = 1")
        .bind(&locale)
        .bind(&direction)
        .bind(now)
        .execute(&state.db)
        .await?;
    state.settings.reload(&state.db).await?;
    Ok(Json(json!({ "message": message })))
}
