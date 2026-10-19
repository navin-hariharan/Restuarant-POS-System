//! The signed-in user's own profile and password.

use crate::{
    api::users::{self, rules},
    auth::AuthUser,
    error::{AppError, AppResult, Errors},
    input::Input,
    state::AppState,
};
use axum::{extract::State, http::HeaderMap, routing::post, Json, Router};
use serde_json::{json, Value};

pub fn router() -> Router<AppState> {
    let demo = || axum::middleware::from_fn(crate::middleware::demo_mode);
    Router::new()
        .route("/account/update", post(update).route_layer(demo()))
        .route("/account/password", post(password).route_layer(demo()))
}

/// Largest avatar (1000 KB), as before.
const MAX_AVATAR_KB: usize = 1000;

async fn update(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    let mut e = Errors::default();
    let name = input.opt_str("name");
    match &name {
        None => e.add("name", rules::required_msg("name")),
        Some(n) if rules::len(n) > 255 => e.add("name", rules::max_msg("name", 255)),
        _ => {}
    }
    let email = input.opt_str("email");
    match &email {
        None => e.add("email", rules::required_msg("email")),
        Some(m) => {
            if !rules::is_email(m) {
                e.add("email", rules::email_msg("email"));
            }
            if rules::len(m) > 255 {
                e.add("email", rules::max_msg("email", 255));
            }
            if !e.has("email") && rules::taken(&state.db, "users", "email", m, Some(user.id)).await? {
                e.add("email", rules::taken_msg("email"));
            }
        }
    }
    if let Some(file) = input.file("avatar") {
        let bytes = file.bytes().await.map_err(anyhow::Error::from)?;
        let is_image = crate::uploads::image_ext(&bytes).is_some();
        if !is_image {
            e.add("avatar", "The avatar must be an image.");
        }
        if file.size > MAX_AVATAR_KB * 1024 {
            e.add("avatar", "The avatar may not be greater than 1000 kilobytes.");
        }
        match rules::image_size(&bytes) {
            Some((w, h)) if w == h && w > 0 => {}
            _ => e.add("avatar", "The avatar has invalid image dimensions."),
        }
    } else if input.has("avatar") {
        // A value that is not a file
        e.add("avatar", "The avatar must be an image.");
        e.add("avatar", "The avatar has invalid image dimensions.");
    }
    e.check()?;

    let mut new_avatar: Option<Option<String>> = None;
    if let Some(file) = input.file("avatar") {
        new_avatar = Some(Some(crate::uploads::store_image(&state, file, "avatar", "avatar").await?));
    } else if input.str("gravatar").as_deref() == Some("true") {
        new_avatar = Some(None);
    }

    // Only changed columns are written (updated_at stays when nothing changed)
    let mut sets: Vec<&str> = vec![];
    let mut args: Vec<crate::query::Arg> = vec![];
    let change = |col: &'static str, value: Option<String>, sets: &mut Vec<&str>, args: &mut Vec<crate::query::Arg>| {
        if user.user.get(col).and_then(Value::as_str).map(str::to_string) != value {
            sets.push(col);
            args.push(value.into());
        }
    };
    change("name", name.clone(), &mut sets, &mut args);
    change("email", email.clone(), &mut sets, &mut args);
    for f in ["phone", "address"] {
        if input.present(f) {
            change(f, input.opt_str(f), &mut sets, &mut args);
        }
    }
    if let Some(a) = &new_avatar {
        change("avatar", a.clone(), &mut sets, &mut args);
    }
    if !sets.is_empty() {
        args.push(state.settings.get().await.now().into());
        args.push(user.id.into());
        let cols: Vec<String> = sets.iter().map(|c| format!("`{c}` = ?")).collect();
        let sql = format!("UPDATE users SET {}, updated_at = ? WHERE id = ?", cols.join(", "));
        crate::query::bind_all(sqlx::query(&sql), &args).execute(&state.db).await?;
    }
    if sets.contains(&"avatar") {
        crate::uploads::delete(&state, user.user.get("avatar").and_then(Value::as_str)).await;
    }
    crate::activity::log(&state, &user, &headers, &state.t("Profile information updated successfully").await, None).await;
    let row = users::load(&state, user.id).await?;
    Ok(Json(json!({
        "message": state.t("Data saved successfully").await,
        "user": users::user_resource(&state, &row).await?,
    })))
}

async fn password(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    let mut e = Errors::default();
    let current = input.str("current_password");
    if current.is_none() {
        e.add("current_password", rules::required_msg("current_password"));
    }
    let new = check_new_password(&input, &mut e);
    e.check()?;
    let (current, new) = (current.unwrap_or_default(), new.unwrap_or_default());
    if !crate::auth::verify_password(&current, user.user.get("password").and_then(Value::as_str).unwrap_or_default()) {
        return Err(AppError::not_acceptable("The password does not match the password"));
    }
    if rules::secure_eq(current.as_bytes(), new.as_bytes()) {
        return Err(AppError::not_acceptable("The new password can not be the previous"));
    }
    let hash = crate::auth::hash_password(&new)?;
    let now = state.settings.get().await.now();
    let mut tx = state.db.begin().await?;
    sqlx::query("UPDATE users SET password = ?, updated_at = ? WHERE id = ?").bind(&hash).bind(now).bind(user.id).execute(&mut *tx).await?;
    // Other devices signed in with the old password are signed out
    sqlx::query("DELETE FROM personal_access_tokens WHERE tokenable_type = ? AND tokenable_id = ? AND id <> ?")
        .bind(crate::auth::TOKENABLE_USER)
        .bind(user.id)
        .bind(user.token_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({ "message": state.t("Password changed successfully").await })))
}

/// `password`: required, at least 6 characters, confirmed.
pub fn check_new_password(input: &Input, e: &mut Errors) -> Option<String> {
    match input.str("password") {
        None => {
            e.add("password", rules::required_msg("password"));
            None
        }
        Some(p) => {
            if rules::len(&p) < 6 {
                e.add("password", rules::min_msg("password", 6));
            }
            let confirmation = input.str("password_confirmation").unwrap_or_default();
            if !rules::secure_eq(p.as_bytes(), confirmation.as_bytes()) {
                e.add("password", "The password confirmation does not match.");
            }
            Some(p)
        }
    }
}
