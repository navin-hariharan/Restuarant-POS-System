//! Restaurant POS server: one binary that serves the JSON API under /api/v1,
//! the web app and stored uploads.
//!
//! Developed by Navin Hariharan.

/// Marks an English message for translation (Settings > Languages); expands to
/// the literal itself. `web/scripts/i18n-keys.mjs` collects these.
#[macro_export]
macro_rules! tr {
    ($s:literal) => {
        $s
    };
}

mod activity;
mod api;
mod auth;
mod bootstrap;
mod config;
mod datefmt;
mod db;
mod error;
mod i18n;
mod input;
mod middleware;
mod notify;
mod query;
mod settings;
mod state;
mod stock;
mod uploads;
mod util;
mod web;

use anyhow::Context;
use axum::{
    extract::DefaultBodyLimit,
    http::StatusCode,
    middleware::{from_fn, from_fn_with_state},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use config::Config;
use serde_json::json;
use state::AppState;
use std::{sync::Arc, time::Duration};
use tower_http::{catch_panic::CatchPanicLayer, compression::CompressionLayer, timeout::TimeoutLayer, trace::TraceLayer};
use tracing_subscriber::EnvFilter;

const USAGE: &str = "Usage:
  pos-server                              start the server
  pos-server set-password <email> [pass]  set a user's password (prints a new one when omitted)
  pos-server migrate                      create or update the database schema, then exit
  pos-server healthcheck                  exit 0 when the local server answers /api/health";

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_env("LOG_LEVEL").unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn,tower_http=warn")))
        .with_target(false)
        .init();

    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        None | Some("serve") => serve().await,
        Some("set-password") => set_password(&args[1..]).await,
        Some("migrate") => migrate().await,
        Some("healthcheck") => healthcheck().await,
        Some("-h" | "--help" | "help") => {
            println!("{USAGE}");
            Ok(())
        }
        Some(other) => Err(anyhow::anyhow!("unknown command `{other}`\n{USAGE}")),
    };
    if let Err(e) = result {
        tracing::error!("{e:#}");
        std::process::exit(1);
    }
}

async fn prepare(cfg: &Config) -> anyhow::Result<db::Db> {
    for dir in [cfg.uploads_dir(), cfg.backups_dir(), cfg.lang_dir(), cfg.tmp_dir()] {
        tokio::fs::create_dir_all(&dir).await.with_context(|| format!("cannot create {}", dir.display()))?;
    }
    // Leftovers of interrupted uploads
    if let Ok(mut rd) = tokio::fs::read_dir(cfg.tmp_dir()).await {
        while let Ok(Some(e)) = rd.next_entry().await {
            let _ = tokio::fs::remove_file(e.path()).await;
        }
    }
    let db = db::connect(&cfg.db, cfg.db_wait_secs).await?;
    let report = bootstrap::run(&db, cfg).await?;
    if report.created {
        tracing::info!("created a new database schema");
    }
    if report.adopted {
        tracing::info!("adopted an existing database");
    }
    for m in &report.migrated {
        tracing::info!(migration = %m, "applied database update");
    }
    if report.seeded {
        match &report.admin_password {
            Some(p) => tracing::warn!(
                "first start: administrator {} was created with password {}  (change it after signing in)",
                cfg.admin_email,
                p
            ),
            None => tracing::info!("first start: administrator {} was created", cfg.admin_email),
        }
    }
    Ok(db)
}

async fn serve() -> anyhow::Result<()> {
    let cfg = Arc::new(Config::from_env()?);
    let db = prepare(&cfg).await?;
    middleware::set_demo_mode(cfg.demo_mode);

    let lang = i18n::Lang::new(cfg.lang_dir());
    lang.init().await?;
    let settings = settings::SettingsStore::default();
    settings.reload(&db).await.map_err(|e| anyhow::anyhow!("cannot read settings: {e:?}"))?;

    let state = AppState {
        cfg: cfg.clone(),
        db,
        settings,
        lang,
        http: reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .user_agent(concat!("pos-server/", env!("CARGO_PKG_VERSION")))
            .build()?,
        maintenance: Default::default(),
        limiter: Default::default(),
    };

    let app = router(state.clone());
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], cfg.port));
    let listener = tokio::net::TcpListener::bind(addr).await.with_context(|| format!("cannot listen on {addr}"))?;
    if !cfg.web_dir.join("index.html").exists() {
        tracing::warn!("web app not found in {} (set WEB_DIR)", cfg.web_dir.display());
    }
    tracing::info!("listening on http://{addr}");
    axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>()).with_graceful_shutdown(shutdown()).await?;
    state.db.close().await;
    Ok(())
}

pub fn router(state: AppState) -> Router {
    // file fields are capped per file in input.rs; this caps the whole body
    let fast = Router::new()
        .nest("/v1", api::router())
        .route("/health", get(health))
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
        .layer(TimeoutLayer::with_status_code(StatusCode::REQUEST_TIMEOUT, Duration::from_secs(120)));
    // Backup uploads and restores can be large and slow.
    let slow = Router::new()
        .nest("/v1", api::backups::upload_router())
        .layer(DefaultBodyLimit::max(usize::try_from(state.cfg.max_backup_upload).unwrap_or(usize::MAX)));
    let api = fast
        .merge(slow)
        .fallback(api_not_found)
        .layer(from_fn_with_state(state.clone(), middleware::translate_errors))
        .layer(from_fn_with_state(state.clone(), middleware::throttle))
        .layer(from_fn(middleware::require_xhr));

    Router::new()
        .nest("/api", api)
        .route("/storage/{*path}", get(web::storage))
        .fallback(get(web::spa))
        .layer(from_fn(middleware::security_headers))
        .layer(CompressionLayer::new())
        .layer(CatchPanicLayer::custom(|_| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "message": "Server Error" }))).into_response()))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn health(axum::extract::State(state): axum::extract::State<AppState>) -> impl IntoResponse {
    let ok = sqlx::query_scalar::<_, i32>("SELECT 1").fetch_one(&state.db).await.is_ok();
    let now = chrono::Utc::now().with_timezone(&state.settings.get().await.tz());
    (
        if ok { StatusCode::OK } else { StatusCode::SERVICE_UNAVAILABLE },
        Json(json!({
            "status": if ok { "ok" } else { "degraded" },
            "database": if ok { "ok" } else { "unavailable" },
            "version": env!("CARGO_PKG_VERSION"),
            "time": now.to_rfc3339_opts(chrono::SecondsFormat::Secs, false),
        })),
    )
}

async fn api_not_found(uri: axum::extract::OriginalUri) -> impl IntoResponse {
    let path = uri.0.path().trim_start_matches('/').to_string();
    (StatusCode::NOT_FOUND, Json(json!({ "message": format!("The route {path} could not be found.") })))
}

async fn shutdown() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = term => {} }
    tracing::info!("shutting down");
}

async fn migrate() -> anyhow::Result<()> {
    let cfg = Config::from_env()?;
    let db = prepare(&cfg).await?;
    db.close().await;
    Ok(())
}

async fn set_password(args: &[String]) -> anyhow::Result<()> {
    let email = args.first().context("missing <email>")?;
    let password = match args.get(1) {
        Some(p) => p.clone(),
        None => util::random_string(16),
    };
    if password.chars().count() < 8 {
        anyhow::bail!("the password must be at least 8 characters");
    }
    let cfg = Config::from_env()?;
    let db = db::connect(&cfg.db, cfg.db_wait_secs).await?;
    let hash = auth::hash_password(&password).map_err(|e| anyhow::anyhow!("{e:?}"))?;
    let done =
        sqlx::query("UPDATE users SET password = ?, updated_at = NOW() WHERE email = ?").bind(&hash).bind(email).execute(&db).await?;
    if done.rows_affected() == 0 {
        anyhow::bail!("no user with email {email}");
    }
    // Sign the user out everywhere
    sqlx::query(
        "DELETE t FROM personal_access_tokens t JOIN users u ON u.id = t.tokenable_id
         WHERE t.tokenable_type = ? AND u.email = ?",
    )
    .bind(auth::TOKENABLE_USER)
    .bind(email)
    .execute(&db)
    .await?;
    if args.get(1).is_some() {
        println!("Password updated for {email}.");
    } else {
        println!("Password for {email} is now: {password}");
    }
    db.close().await;
    Ok(())
}

async fn healthcheck() -> anyhow::Result<()> {
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080);
    let res = tokio::time::timeout(Duration::from_secs(4), async {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port)).await?;
        s.write_all(b"GET /api/health HTTP/1.0\r\nHost: localhost\r\n\r\n").await?;
        let mut buf = vec![0u8; 64];
        let n = s.read(&mut buf).await?;
        Ok::<_, std::io::Error>(String::from_utf8_lossy(&buf[..n]).into_owned())
    })
    .await
    .context("timed out")??;
    if res.starts_with("HTTP/1.1 200") || res.starts_with("HTTP/1.0 200") {
        Ok(())
    } else {
        anyhow::bail!("unhealthy: {}", res.lines().next().unwrap_or(""))
    }
}
