//! User activity log (Settings > Activity logs).

use crate::{auth::AuthUser, state::AppState};
use axum::http::HeaderMap;

/// Client address: first X-Forwarded-For entry (set by the Dokploy/Traefik
/// proxy), then X-Real-IP, else "unknown".
pub fn client_ip(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| headers.get("x-real-ip").and_then(|v| v.to_str().ok()).map(|s| s.trim().to_string()))
        .unwrap_or_else(|| "unknown".into())
}

pub fn user_agent(headers: &HeaderMap) -> String {
    headers.get("user-agent").and_then(|v| v.to_str().ok()).unwrap_or("unknown").to_string()
}

fn clip(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// Record an action. `activity` is the English message key (translated when
/// shown), `link` an optional reference such as an order number or a name.
/// Failures are logged, never returned: logging must not break the action.
pub async fn log(state: &AppState, user: &AuthUser, headers: &HeaderMap, activity: &str, link: Option<&str>) {
    log_for(state, user.id, headers, activity, link).await
}

pub async fn log_for(state: &AppState, user_id: i64, headers: &HeaderMap, activity: &str, link: Option<&str>) {
    let now = state.settings.get().await.now();
    let res = sqlx::query(
        "INSERT INTO user_activity_logs (user_id, activity, device, ip, link, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(user_id)
    .bind(clip(activity, 191))
    .bind(clip(&user_agent(headers), 191))
    .bind(clip(&client_ip(headers), 191))
    .bind(link.map(|l| clip(l, 191)))
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await;
    if let Err(e) = res {
        tracing::warn!(error = %e, "could not write the activity log");
    }
}
