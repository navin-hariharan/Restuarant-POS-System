//! Everything outside /api: the web app (with index.html fallback for client
//! routes) and stored uploads under /storage.

use crate::{state::AppState, uploads::safe_join};
use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderValue, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use tokio_util::io::ReaderStream;

async fn send_file(path: &std::path::Path, cache: &'static str, extra_csp: Option<&'static str>) -> Option<Response> {
    let meta = tokio::fs::metadata(path).await.ok()?;
    if !meta.is_file() {
        return None;
    }
    let file = tokio::fs::File::open(path).await.ok()?;
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut res = Response::new(Body::from_stream(ReaderStream::new(file)));
    let h = res.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_str(mime.as_ref()).unwrap_or(HeaderValue::from_static("application/octet-stream")));
    h.insert(header::CONTENT_LENGTH, HeaderValue::from(meta.len()));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    if let Some(csp) = extra_csp {
        h.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(csp));
    }
    Some(res)
}

/// GET /storage/{*path}: uploaded images. Served inert (sandboxed, no sniffing).
pub async fn storage(State(state): State<AppState>, Path(path): Path<String>) -> Response {
    let Some(file) = safe_join(&state.cfg.uploads_dir(), &path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    send_file(&file, "public, max-age=86400", Some("default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"))
        .await
        .unwrap_or_else(|| StatusCode::NOT_FOUND.into_response())
}

/// Any other GET: a file of the web app, else index.html for client routes.
pub async fn spa(State(state): State<AppState>, uri: Uri) -> Response {
    let rel = uri.path().trim_start_matches('/');
    if !rel.is_empty() {
        if let Some(file) = safe_join(&state.cfg.web_dir, rel) {
            // hashed build assets never change
            let cache = if rel.starts_with("assets/") { "public, max-age=31536000, immutable" } else { "public, max-age=3600" };
            if let Some(res) = send_file(&file, cache, None).await {
                return res;
            }
        }
        // Missing static-looking files are 404s, not the app
        if rel.starts_with("assets/") || rel.starts_with("images/") || rel.starts_with("sounds/") {
            return StatusCode::NOT_FOUND.into_response();
        }
    }
    match send_file(&state.cfg.web_dir.join("index.html"), "no-cache", None).await {
        Some(res) => res,
        None => (StatusCode::SERVICE_UNAVAILABLE, "The web app is not built (WEB_DIR has no index.html).").into_response(),
    }
}
