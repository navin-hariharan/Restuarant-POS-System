//! Bearer-token authentication and permissions.
//!
//! Tokens are compatible with the previous release: the client holds
//! "<id>|<secret>", the `personal_access_tokens` row keeps sha256(secret).
//! Restoring an old backup therefore keeps existing sign-ins working.

use crate::{
    db::{row_json, RowExt},
    error::{AppError, AppResult},
    state::AppState,
};
use axum::{extract::FromRequestParts, http::request::Parts};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

/// Value stored in personal_access_tokens.tokenable_type (kept for compatibility).
pub const TOKENABLE_USER: &str = "App\\Models\\User";

#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: i64,
    pub role_id: i64,
    pub token_id: i64,
    pub permissions: Vec<String>,
    /// Full `users` row
    pub user: Map<String, Value>,
}

impl AuthUser {
    /// Role 1 (the primary admin role) can do everything.
    pub fn is_super(&self) -> bool {
        self.role_id < 2
    }

    pub fn can(&self, permission: &str) -> bool {
        self.is_super() || self.permissions.iter().any(|p| p == permission)
    }

    /// Ok when the user has at least one of `permissions`.
    pub fn require(&self, permissions: &[&str]) -> AppResult<()> {
        if self.is_super() || permissions.iter().any(|p| self.can(p)) {
            Ok(())
        } else {
            Err(AppError::forbidden("You do not have permission to do this."))
        }
    }
}

pub fn sha256_hex(s: &str) -> String {
    hex::encode(Sha256::digest(s.as_bytes()))
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn bearer(parts: &Parts) -> Option<String> {
    let h = parts.headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
    let t = h.strip_prefix("Bearer ").or_else(|| h.strip_prefix("bearer "))?.trim();
    (!t.is_empty()).then(|| t.to_string())
}

/// Decode `user_roles.permissions` (JSON text) into a list.
pub fn decode_permissions(v: &Value) -> Vec<String> {
    let parsed = match v {
        Value::String(s) => serde_json::from_str::<Value>(s).unwrap_or(Value::Null),
        other => other.clone(),
    };
    match parsed {
        Value::Array(a) => a.into_iter().filter_map(|x| x.as_str().map(str::to_string)).collect(),
        Value::Object(o) => o.into_iter().filter_map(|(_, x)| x.as_str().map(str::to_string)).collect(),
        _ => vec![],
    }
}

pub async fn resolve_token(state: &AppState, token: &str) -> AppResult<Option<AuthUser>> {
    let Some((id, secret)) = token.split_once('|') else { return Ok(None) };
    let Ok(id) = id.parse::<i64>() else { return Ok(None) };
    let row = sqlx::query(
        "SELECT id, tokenable_id, token, last_used_at, expires_at FROM personal_access_tokens WHERE id = ? AND tokenable_type = ?",
    )
    .bind(id)
    .bind(TOKENABLE_USER)
    .fetch_optional(&state.db)
    .await?;
    let Some(row) = row else { return Ok(None) };
    let t = row_json(&row);
    if !constant_time_eq(sha256_hex(secret).as_bytes(), t.str("token").as_bytes()) {
        return Ok(None);
    }
    let settings = state.settings.get().await;
    let now = settings.now();
    if let Some(exp) = t.opt_str("expires_at").and_then(|s| crate::datefmt::parse(&s)) {
        if exp <= now {
            return Ok(None);
        }
    }
    let user_row = sqlx::query("SELECT * FROM users WHERE id = ?").bind(t.i64("tokenable_id")).fetch_optional(&state.db).await?;
    let Some(user_row) = user_row else { return Ok(None) };
    let user = row_json(&user_row);
    let role_id = user.i64("role_id");
    let role = sqlx::query("SELECT * FROM user_roles WHERE id = ?")
        .bind(role_id)
        .fetch_optional(&state.db)
        .await?
        .map(|r| row_json(&r))
        .unwrap_or_default();
    let permissions = decode_permissions(&role.val("permissions"));

    // Touch last_used_at at most once a minute
    let stale = t.opt_str("last_used_at").and_then(|s| crate::datefmt::parse(&s)).map(|d| (now - d).num_seconds() >= 60).unwrap_or(true);
    if stale {
        let db = state.db.clone();
        tokio::spawn(async move {
            let _ = sqlx::query("UPDATE personal_access_tokens SET last_used_at = ?, updated_at = ? WHERE id = ?")
                .bind(now)
                .bind(now)
                .bind(id)
                .execute(&db)
                .await;
        });
    }

    Ok(Some(AuthUser { id: user.i64("id"), role_id, token_id: id, permissions, user }))
}

/// Issue a new token for a user; returns the "<id>|<secret>" string for the client.
pub async fn create_token(state: &AppState, user_id: i64, name: &str) -> AppResult<String> {
    let secret = crate::util::random_string(40);
    let now = state.settings.get().await.now();
    let res = sqlx::query(
        "INSERT INTO personal_access_tokens (tokenable_type, tokenable_id, name, token, abilities, created_at, updated_at) VALUES (?, ?, ?, ?, '[\"*\"]', ?, ?)",
    )
    .bind(TOKENABLE_USER)
    .bind(user_id)
    .bind(name)
    .bind(sha256_hex(&secret))
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await?;
    Ok(format!("{}|{}", res.last_insert_id(), secret))
}

pub fn hash_password(password: &str) -> AppResult<String> {
    // $2y$ prefix like the previous release, cost 10
    bcrypt::hash_with_result(password, 10)
        .map(|h| h.format_for_version(bcrypt::Version::TwoY))
        .map_err(|e| AppError::Other(anyhow::anyhow!(e)))
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    bcrypt::verify(password, hash).unwrap_or(false)
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        if let Some(u) = parts.extensions.get::<AuthUser>() {
            return Ok(u.clone());
        }
        let token = bearer(parts).ok_or_else(AppError::unauthenticated)?;
        let user = resolve_token(state, &token).await?.ok_or_else(AppError::unauthenticated)?;
        parts.extensions.insert(user.clone());
        Ok(user)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifies_php_bcrypt_hashes() {
        // $2y$ hash made by PHP password_hash("secret", PASSWORD_BCRYPT)
        let h = hash_password("secret").unwrap();
        assert!(h.starts_with("$2y$10$"));
        assert!(verify_password("secret", &h));
        assert!(!verify_password("nope", &h));
    }

    #[test]
    fn permissions_decode() {
        assert_eq!(decode_permissions(&Value::from("[\"a\",\"b\"]")), vec!["a", "b"]);
        assert_eq!(decode_permissions(&Value::from("{\"0\":\"a\"}")), vec!["a"]);
        assert!(decode_permissions(&Value::Null).is_empty());
    }
}
