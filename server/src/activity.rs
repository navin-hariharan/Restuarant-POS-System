//! User activity log (Settings > Activity logs).

use crate::{auth::AuthUser, state::AppState};
use axum::http::HeaderMap;
use std::net::{IpAddr, SocketAddr};

/// Request header holding the client address worked out by
/// `middleware::client_address`, which replaces any value a client sends.
pub const CLIENT_IP_HEADER: &str = "x-pos-client-ip";

/// Client address of the request, or "unknown".
pub fn client_ip(headers: &HeaderMap) -> String {
    headers.get(CLIENT_IP_HEADER).and_then(|v| v.to_str().ok()).unwrap_or("unknown").to_string()
}

/// One address as a proxy writes it: "1.2.3.4", "1.2.3.4:567", "::1" or "[::1]:567".
fn parse_ip(s: &str) -> Option<IpAddr> {
    let s = s.trim();
    s.parse::<IpAddr>().ok().or_else(|| s.parse::<SocketAddr>().ok().map(|a| a.ip()))
}

/// The client address behind `hops` trusted proxies. Each proxy appends the
/// address it was reached from to X-Forwarded-For, so the client is the
/// `hops`-th entry from the right; entries further left are whatever the
/// client sent. With no trusted proxy the connection's address is used.
pub fn pick_client_ip(xff: Option<&str>, real_ip: Option<&str>, peer: Option<IpAddr>, hops: usize, trust_real_ip: bool) -> Option<IpAddr> {
    if hops == 0 {
        return peer;
    }
    let entries: Vec<&str> = xff.map(|v| v.split(',').map(str::trim).filter(|e| !e.is_empty()).collect()).unwrap_or_default();
    if entries.is_empty() {
        return match real_ip {
            Some(ip) if trust_real_ip => parse_ip(ip).or(peer),
            _ => peer,
        };
    }
    // Fewer entries than proxies: the first one is the closest to the client.
    let entry = entries[entries.len().saturating_sub(hops)];
    parse_ip(entry).or(peer)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> Option<IpAddr> {
        Some(s.parse().unwrap())
    }

    #[test]
    fn forwarded_for_hops() {
        let peer = ip("10.0.0.2");
        let xff = Some("6.6.6.6, 1.1.1.1, 10.0.0.9");
        assert_eq!(pick_client_ip(xff, None, peer, 0, false), peer);
        assert_eq!(pick_client_ip(xff, None, peer, 1, false), ip("10.0.0.9"));
        assert_eq!(pick_client_ip(xff, None, peer, 2, false), ip("1.1.1.1"));
        // Changing what the client put first changes nothing
        assert_eq!(pick_client_ip(Some("9.9.9.9, 1.1.1.1"), None, peer, 1, false), ip("1.1.1.1"));
        // Fewer entries than proxies
        assert_eq!(pick_client_ip(Some("1.1.1.1"), None, peer, 3, false), ip("1.1.1.1"));
    }

    #[test]
    fn missing_or_malformed_headers() {
        let peer = ip("10.0.0.2");
        assert_eq!(pick_client_ip(None, None, peer, 1, false), peer);
        assert_eq!(pick_client_ip(Some(" , "), None, peer, 1, false), peer);
        assert_eq!(pick_client_ip(Some("1.1.1.1, not-an-ip"), None, peer, 1, false), peer);
        assert_eq!(pick_client_ip(Some("1.1.1.1, 2.2.2.2:443"), None, peer, 1, false), ip("2.2.2.2"));
        assert_eq!(pick_client_ip(Some("[2001:db8::1]:80"), None, None, 1, false), ip("2001:db8::1"));
        assert_eq!(pick_client_ip(None, None, None, 1, false), None);
        // X-Real-IP only when configured
        assert_eq!(pick_client_ip(None, Some("3.3.3.3"), peer, 1, false), peer);
        assert_eq!(pick_client_ip(None, Some("3.3.3.3"), peer, 1, true), ip("3.3.3.3"));
        assert_eq!(pick_client_ip(None, Some("3.3.3.3"), peer, 0, true), peer);
    }
}
