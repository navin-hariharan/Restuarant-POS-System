//! Cross-cutting request handling: API-only checks, rate limiting and
//! security headers.

use crate::state::AppState;
use axum::{
    body::Body,
    extract::{ConnectInfo, OriginalUri, Request, State},
    http::{header, HeaderName, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use dashmap::DashMap;
use serde_json::json;
use std::{
    net::SocketAddr,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

/// The full request path, also inside nested routers (which strip their prefix).
pub fn full_path(req: &Request) -> &str {
    req.extensions().get::<OriginalUri>().map(|u| u.0.path()).unwrap_or_else(|| req.uri().path())
}

/// API calls must come from the web app (X-Requested-With), which also stops
/// cross-site form posts. Only the health check is exempt.
pub async fn require_xhr(req: Request, next: Next) -> Response {
    let path = full_path(&req);
    let exempt = path == "/api/health";
    let xhr = req
        .headers()
        .get("x-requested-with")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.eq_ignore_ascii_case("XMLHttpRequest"))
        .unwrap_or(false);
    if !exempt && !xhr {
        return (StatusCode::NOT_FOUND, Json(json!({ "message": "Not found." }))).into_response();
    }
    next.run(req).await
}

#[derive(Clone, Default)]
pub struct RateLimiter {
    hits: Arc<DashMap<String, (u64, u32)>>,
}

impl RateLimiter {
    /// Count a hit for `key` in the current minute; false when over `limit`.
    pub fn allow(&self, key: &str, limit: u32) -> bool {
        let minute = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() / 60).unwrap_or(0);
        let mut e = self.hits.entry(key.to_string()).or_insert((minute, 0));
        if e.0 != minute {
            *e = (minute, 0);
        }
        e.1 += 1;
        let ok = e.1 <= limit;
        drop(e);
        if self.hits.len() > 50_000 {
            self.hits.retain(|_, v| v.0 == minute);
        }
        ok
    }
}

/// Work out the client address once per request (see `activity::pick_client_ip`)
/// and keep it in a header that clients can not set themselves.
pub async fn client_address(State(state): State<AppState>, mut req: Request, next: Next) -> Response {
    let ip = {
        let headers = req.headers();
        let forwarded = headers.get_all("x-forwarded-for").iter().filter_map(|v| v.to_str().ok()).collect::<Vec<_>>().join(",");
        let real_ip = headers.get("x-real-ip").and_then(|v| v.to_str().ok());
        let peer = req.extensions().get::<ConnectInfo<SocketAddr>>().map(|c| c.0.ip());
        let forwarded = Some(forwarded.as_str()).filter(|f| !f.is_empty());
        crate::activity::pick_client_ip(forwarded, real_ip, peer, state.cfg.trusted_proxies, state.cfg.trust_real_ip)
    };
    let headers = req.headers_mut();
    headers.remove(crate::activity::CLIENT_IP_HEADER);
    if let Some(value) = ip.and_then(|ip| HeaderValue::from_str(&ip.to_string()).ok()) {
        headers.insert(crate::activity::CLIENT_IP_HEADER, value);
    }
    next.run(req).await
}

/// Per-minute API limit per signed-in user's token, else per client address.
/// A token only gets its own budget once it is verified (the result is kept
/// for the handler, so it is looked up once). The POS screen polls a lot, so
/// its routes are not counted.
pub async fn throttle(State(state): State<AppState>, mut req: Request, next: Next) -> Response {
    let path = full_path(&req);
    let exempt = path.starts_with("/api/v1/pos/") || path == "/api/v1/auth/check" || path == "/api/health";
    if !exempt {
        let user = match crate::auth::bearer_token(req.headers()) {
            Some(token) => match crate::auth::resolve_token(&state, &token).await {
                Ok(user) => user,
                Err(e) => return e.into_response(),
            },
            None => None,
        };
        let key = match user {
            Some(user) => {
                let key = format!("t:{}", user.token_id);
                req.extensions_mut().insert(user);
                key
            }
            None => format!("ip:{}", crate::activity::client_ip(req.headers())),
        };
        if !state.limiter.allow(&key, state.cfg.throttle_per_minute) {
            let mut res =
                (StatusCode::TOO_MANY_REQUESTS, Json(json!({ "message": "Too many requests. Please wait a minute." }))).into_response();
            res.headers_mut().insert(header::RETRY_AFTER, HeaderValue::from_static("60"));
            return res;
        }
    }
    next.run(req).await
}

/// Sign-in attempts: 10 per minute per address, on top of the general limit.
pub fn login_allowed(state: &AppState, headers: &axum::http::HeaderMap) -> bool {
    state.limiter.allow(&format!("login:{}", crate::activity::client_ip(headers)), 10)
}

const CSP: &str = "default-src 'self'; script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/; frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; media-src 'self' data: blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";

pub async fn security_headers(req: Request<Body>, next: Next) -> Response {
    let is_api = full_path(&req).starts_with("/api/");
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    let set = |h: &mut axum::http::HeaderMap, k: &'static str, v: &'static str| {
        h.entry(HeaderName::from_static(k)).or_insert(HeaderValue::from_static(v));
    };
    set(h, "x-content-type-options", "nosniff");
    set(h, "x-frame-options", "SAMEORIGIN");
    set(h, "referrer-policy", "strict-origin-when-cross-origin");
    set(h, "permissions-policy", "camera=(self), microphone=(), geolocation=(), payment=()");
    set(h, "cross-origin-opener-policy", "same-origin");
    if is_api {
        set(h, "cache-control", "no-store");
    } else {
        set(h, "content-security-policy", CSP);
    }
    res
}

/// Error messages are written in English and translated here, once, into the
/// app's language (Settings > Localization).
pub async fn translate_errors(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let res = next.run(req).await;
    if res.extensions().get::<crate::error::Translate>().is_none() {
        return res;
    }
    let locale = state.settings.get().await.opt_str("app_locale").unwrap_or_else(|| "en".into());
    let (mut parts, body) = res.into_parts();
    let Ok(bytes) = axum::body::to_bytes(body, 256 * 1024).await else {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "message": "Server Error" }))).into_response();
    };
    let Ok(mut v) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return Response::from_parts(parts, Body::from(bytes));
    };
    if let Some(m) = v.get_mut("message") {
        if let Some(s) = m.as_str() {
            *m = state.lang.t(&locale, s, &[]).await.into();
        }
    }
    if let Some(errors) = v.get_mut("errors").and_then(|e| e.as_object_mut()) {
        for list in errors.values_mut() {
            if let Some(items) = list.as_array_mut() {
                for item in items {
                    if let Some(s) = item.as_str() {
                        *item = state.lang.t(&locale, s, &[]).await.into();
                    }
                }
            }
        }
    }
    let out = serde_json::to_vec(&v).unwrap_or_default();
    parts.headers.insert(header::CONTENT_LENGTH, HeaderValue::from(out.len()));
    Response::from_parts(parts, Body::from(out))
}

static DEMO: std::sync::OnceLock<bool> = std::sync::OnceLock::new();

pub fn set_demo_mode(on: bool) {
    let _ = DEMO.set(on);
}

/// Demo installations accept changes but do not keep them (route layer for
/// the actions that change data).
pub async fn demo_mode(req: Request, next: Next) -> Response {
    if *DEMO.get().unwrap_or(&false) && req.method() != axum::http::Method::GET {
        return Json(json!({ "message": "Action performed successfully but changes are disabled while mode" })).into_response();
    }
    next.run(req).await
}
