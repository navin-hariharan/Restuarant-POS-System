//! Database backups (Settings > Database backups).
//!
//! Files live in `<data>/backups`:
//! - `backup-<time>.sql`        manual backups, limited by DB_BACKUPS_LIMIT
//! - `uploaded-<time>-<id>.sql[.gz]` backups uploaded from elsewhere
//! - `pre-restore-<time>.sql`   safety copy taken before every restore (newest 5 kept)
//!
//! Dumps go to a temporary file renamed only when the dump tool succeeded, so a
//! failed dump never leaves a truncated backup. Backups and restores run one at
//! a time (`state.maintenance`) and keep running if the browser disconnects.
//! Nothing is ever imported automatically.

use crate::{
    activity,
    auth::AuthUser,
    config::Config,
    error::{AppError, AppResult},
    state::AppState,
};
use axum::{
    body::Body,
    extract::{multipart::MultipartRejection, Multipart, Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::from_fn,
    response::{IntoResponse, Response},
    routing::{get, patch, post},
    Json, Router,
};
use serde_json::{json, Map, Value};
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::{Path as FsPath, PathBuf},
    time::Duration,
};
use tokio::io::AsyncWriteExt;

const PERMISSION: &str = "database_backup";
/// Safety copies kept per kind
const KEEP_AUTOMATIC: usize = 5;
/// Bytes inspected to decide whether a file is a SQL dump
const SNIFF_BYTES: usize = 64 * 1024;
/// Longest a dump or an import may run
const TOOL_TIMEOUT: Duration = Duration::from_secs(3 * 3600);

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/backups", get(index))
        .route("/admin/backups/{file}/remove", post(remove).route_layer(from_fn(crate::middleware::demo_mode)))
}

/// Routes that take large uploads (mounted without the normal body limit).
pub fn upload_router() -> Router<AppState> {
    let demo = || from_fn(crate::middleware::demo_mode);
    Router::new()
        .route("/admin/backups", post(create))
        .route("/admin/backups/upload", post(upload).route_layer(demo()))
        .route("/admin/backups/{file}/restore", patch(restore).route_layer(demo()))
        .route("/admin/backups/{file}/download", get(download))
}

/* ----------------------------------------------------------------- naming */

/// A backup file name a request may refer to (no paths, known extensions).
pub fn valid_name(name: &str) -> bool {
    let base = name.strip_suffix(".sql.gz").or_else(|| name.strip_suffix(".sql"));
    match base {
        Some(b) => {
            name.len() <= 200
                && b.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
                && b.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
                && !b.contains("..")
        }
        None => false,
    }
}

fn kind_of(name: &str) -> &'static str {
    if name.starts_with("backup-") {
        "manual"
    } else if name.starts_with("uploaded-") {
        "uploaded"
    } else {
        "pre-restore"
    }
}

/// "1,234.56MB" like PHP number_format(bytes / 1048576, 2)
fn size_mb(bytes: u64) -> String {
    let fixed = format!("{:.2}", bytes as f64 / 1_048_576.0);
    let (int, frac) = fixed.split_once('.').unwrap_or((&fixed, "00"));
    let mut grouped = String::new();
    for (i, c) in int.chars().enumerate() {
        if i > 0 && (int.len() - i) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(c);
    }
    format!("{grouped}.{frac}MB")
}

struct Entry {
    name: String,
    size: u64,
    modified: std::time::SystemTime,
}

async fn list_files(dir: &FsPath) -> Vec<Entry> {
    let mut out = vec![];
    let Ok(mut rd) = tokio::fs::read_dir(dir).await else { return out };
    while let Ok(Some(e)) = rd.next_entry().await {
        let name = e.file_name().to_string_lossy().to_string();
        if !valid_name(&name) {
            continue;
        }
        let Ok(meta) = e.metadata().await else { continue };
        if !meta.is_file() {
            continue;
        }
        out.push(Entry { name, size: meta.len(), modified: meta.modified().unwrap_or(std::time::UNIX_EPOCH) });
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| b.name.cmp(&a.name)));
    out
}

/// `<prefix>-Y-m-d_H-i-s[-tag][-n]<ext>` that does not exist yet.
async fn new_name(state: &AppState, prefix: &str, tag: Option<&str>, ext: &str) -> String {
    let mut stamp = state.settings.get().await.now().format("%Y-%m-%d_%H-%M-%S").to_string();
    if let Some(t) = tag {
        stamp = format!("{stamp}-{t}");
    }
    let dir = state.cfg.backups_dir();
    let mut name = format!("{prefix}-{stamp}{ext}");
    let mut n = 2;
    while tokio::fs::try_exists(dir.join(&name)).await.unwrap_or(false)
        || tokio::fs::try_exists(dir.join(format!("{name}.part"))).await.unwrap_or(false)
    {
        name = format!("{prefix}-{stamp}-{n}{ext}");
        n += 1;
    }
    name
}

/// The path of an existing backup named in a request.
async fn existing(state: &AppState, name: &str) -> AppResult<PathBuf> {
    if !valid_name(name) {
        return Err(AppError::unprocessable("Invalid backup file name"));
    }
    let path = state.cfg.backups_dir().join(name);
    match tokio::fs::metadata(&path).await {
        Ok(m) if m.is_file() => Ok(path),
        _ => Err(AppError::Status(StatusCode::NOT_FOUND, tr!("File does not exist !").into())),
    }
}

fn busy() -> AppError {
    AppError::conflict("Another backup or restore is running. Try again in a moment.")
}

/* ------------------------------------------------------------------ tools */

/// Arguments that connect a mariadb client tool to our database.
fn connection_args(cfg: &Config) -> Vec<String> {
    vec![format!("--user={}", cfg.db.username), format!("--host={}", cfg.db.host), format!("--port={}", cfg.db.port)]
}

/// Newer clients insist on TLS; a server without it needs --skip-ssl.
fn tls_refused(stderr: &str) -> bool {
    stderr.contains("ERROR 2026") || stderr.contains("SSL is required") || stderr.contains("TLS/SSL error")
}

/// A short, safe description of a tool failure (error code and line only;
/// the full output goes to the server log).
pub fn tool_summary(stderr: &str) -> String {
    let re = regex::Regex::new(r"ERROR \d+ \([0-9A-Z]+\)(?: at line \d+)?|Got error: \d+|errno: \d+").ok();
    if let Some(m) = re.as_ref().and_then(|r| r.find(stderr)) {
        return m.as_str().to_string();
    }
    if stderr.contains("Access denied") {
        return "access denied".into();
    }
    "see the server log for details".into()
}

/// Dump the database into `<backups>/<name>`.
async fn dump_to(cfg: &Config, name: &str) -> Result<(), String> {
    let dir = cfg.backups_dir();
    tokio::fs::create_dir_all(&dir).await.map_err(|e| format!("cannot create the backups folder ({e})"))?;
    let final_path = dir.join(name);
    let tmp = dir.join(format!("{name}.part"));
    let mut last_err = String::new();
    for skip_ssl in [false, true] {
        let mut cmd = tokio::process::Command::new(&cfg.dump_bin);
        cmd.args(["--single-transaction", "--quick", "--no-tablespaces", "--skip-lock-tables", "--default-character-set=utf8mb4"]);
        if skip_ssl {
            cmd.arg("--skip-ssl");
        }
        cmd.arg(format!("--result-file={}", tmp.display()))
            .args(connection_args(cfg))
            .arg(&cfg.db.database)
            .env("MYSQL_PWD", &cfg.db.password)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        let out = match tokio::time::timeout(TOOL_TIMEOUT, cmd.output()).await {
            Ok(Ok(o)) => o,
            Ok(Err(e)) => {
                let _ = tokio::fs::remove_file(&tmp).await;
                tracing::error!(error = %e, tool = %cfg.dump_bin, "cannot run the database dump tool");
                return Err("the database dump tool is not available (MYSQLDUMP_PATH)".into());
            }
            Err(_) => {
                let _ = tokio::fs::remove_file(&tmp).await;
                return Err("the database dump took too long".into());
            }
        };
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        let size = tokio::fs::metadata(&tmp).await.map(|m| m.len()).unwrap_or(0);
        if out.status.success() && size > 0 {
            tokio::fs::rename(&tmp, &final_path).await.map_err(|e| {
                tracing::error!(error = %e, "cannot save the dump");
                "unable to save the database dump".to_string()
            })?;
            return Ok(());
        }
        let _ = tokio::fs::remove_file(&tmp).await;
        tracing::error!(stderr = %stderr.trim(), status = %out.status, "database dump failed");
        last_err = format!("Database dump failed ({}).", tool_summary(&stderr));
        if skip_ssl || !tls_refused(&stderr) {
            break;
        }
    }
    Err(last_err)
}

/// Remove old safety copies with `prefix`, keeping the newest few (and `keep`).
async fn prune(dir: &FsPath, prefix: &str, keep: Option<&str>) {
    let files: Vec<Entry> = list_files(dir).await.into_iter().filter(|e| e.name.starts_with(prefix)).collect();
    for e in files.iter().skip(KEEP_AUTOMATIC) {
        if Some(e.name.as_str()) != keep {
            let _ = tokio::fs::remove_file(dir.join(&e.name)).await;
        }
    }
}

/* ------------------------------------------------------------ SQL filter */

fn collation_regex() -> regex::bytes::Regex {
    // MySQL 8 collations MariaDB does not know (utf8mb4_0900_ai_ci and the
    // language specific *_0900_* ones)
    regex::bytes::Regex::new(r"(?i-u)\butf8mb4_[a-z0-9_]*0900[a-z0-9_]*")
        .unwrap_or_else(|_| regex::bytes::Regex::new("$^").expect("static"))
}

fn starts_with_ci(line: &[u8], prefix: &[u8]) -> bool {
    line.len() >= prefix.len() && line[..prefix.len()].eq_ignore_ascii_case(prefix)
}

/// Copy a dump, making it importable here: drop the leading sandbox-mode
/// line newer mariadb-dump writes, statements that would switch to another
/// database, and map MySQL 8 collations to utf8mb4_unicode_ci. Data lines
/// (INSERT) are passed through untouched. Returns whether the dump creates
/// the `migrations` table.
pub fn filter_dump<R: BufRead, W: Write>(mut reader: R, out: &mut W) -> std::io::Result<bool> {
    let re = collation_regex();
    let mut has_migrations = false;
    let mut line = Vec::with_capacity(64 * 1024);
    let mut first = true;
    loop {
        line.clear();
        if reader.read_until(b'\n', &mut line)? == 0 {
            break;
        }
        if first {
            first = false;
            let body = line.strip_prefix(b"\xEF\xBB\xBF".as_slice()).unwrap_or(&line);
            if body.starts_with(b"/*M!999999") && body.windows(7).any(|w| w == b"sandbox") {
                continue;
            }
        }
        if starts_with_ci(&line, b"INSERT INTO") {
            out.write_all(&line)?;
            continue;
        }
        if starts_with_ci(&line, b"USE `") || starts_with_ci(&line, b"CREATE DATABASE") {
            continue;
        }
        if starts_with_ci(&line, b"CREATE TABLE `migrations`") || starts_with_ci(&line, b"CREATE TABLE IF NOT EXISTS `migrations`") {
            has_migrations = true;
        }
        if line.windows(4).any(|w| w == b"0900") {
            out.write_all(&re.replace_all(&line, b"utf8mb4_unicode_ci".as_slice()))?;
        } else {
            out.write_all(&line)?;
        }
    }
    out.flush()?;
    Ok(has_migrations)
}

fn open_dump(path: &FsPath) -> std::io::Result<Box<dyn BufRead + Send>> {
    let file = std::fs::File::open(path)?;
    let gz = path.to_string_lossy().ends_with(".gz");
    Ok(if gz {
        Box::new(BufReader::with_capacity(1 << 20, flate2::read::MultiGzDecoder::new(BufReader::new(file))))
    } else {
        Box::new(BufReader::with_capacity(1 << 20, file))
    })
}

/// Stream a backup into the database with the mariadb client (blocking).
/// Returns whether the backup had its own `migrations` table.
fn import_blocking(cfg: &Config, path: &FsPath) -> Result<bool, String> {
    for skip_ssl in [false, true] {
        let reader = open_dump(path).map_err(|e| format!("cannot read the backup ({e})"))?;
        let mut cmd = std::process::Command::new(&cfg.client_bin);
        cmd.args(["--default-character-set=utf8mb4", "--max-allowed-packet=1073741824"]);
        if skip_ssl {
            cmd.arg("--skip-ssl");
        }
        cmd.args(connection_args(cfg))
            .arg(&cfg.db.database)
            .env("MYSQL_PWD", &cfg.db.password)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped());
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                tracing::error!(error = %e, tool = %cfg.client_bin, "cannot run the database client");
                return Err("the database client is not available (MYSQL_CLIENT_PATH)".into());
            }
        };
        let stderr_pipe = child.stderr.take();
        let collector = std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut p) = stderr_pipe {
                let mut chunk = [0u8; 8192];
                while let Ok(n) = p.read(&mut chunk) {
                    if n == 0 {
                        break;
                    }
                    if buf.len() < 64 * 1024 {
                        buf.extend_from_slice(&chunk[..n]);
                    }
                }
            }
            String::from_utf8_lossy(&buf).to_string()
        });
        let written = match child.stdin.take() {
            Some(stdin) => {
                let mut w = std::io::BufWriter::with_capacity(1 << 20, stdin);
                filter_dump(reader, &mut w)
            }
            None => Err(std::io::Error::other("no stdin")),
        };
        let status = child.wait().map_err(|e| format!("database client failed ({e})"))?;
        let stderr = collector.join().unwrap_or_default();
        if status.success() {
            return written.map_err(|e| {
                tracing::error!(error = %e, "reading the backup failed");
                "the backup file could not be read completely (is it damaged?)".to_string()
            });
        }
        tracing::error!(stderr = %stderr.trim(), %status, "database restore failed");
        if !skip_ssl && tls_refused(&stderr) {
            continue;
        }
        return Err(format!("Database restore failed ({}).", tool_summary(&stderr)));
    }
    Err("Database restore failed.".into())
}

/* ---------------------------------------------------------------- handlers */

async fn index(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(&[PERMISSION])?;
    let tz = state.settings.get().await.tz();
    let list: Vec<Value> = list_files(&state.cfg.backups_dir())
        .await
        .into_iter()
        .map(|e| {
            let time = chrono::DateTime::<chrono::Utc>::from(e.modified).with_timezone(&tz).format("%a %d-%b-%Y %H:%M:%S").to_string();
            let kind = kind_of(&e.name);
            json!({
                "uuid": crate::util::uuid(),
                "name": e.name,
                "size": size_mb(e.size),
                "time": time,
                "automatic": kind == "pre-restore",
                "kind": kind,
            })
        })
        .collect();
    Ok(Json(json!({ "list": list })))
}

async fn create(State(state): State<AppState>, user: AuthUser, headers: HeaderMap) -> AppResult<Response> {
    user.require(&[PERMISSION])?;
    let manual = list_files(&state.cfg.backups_dir()).await.iter().filter(|e| kind_of(&e.name) == "manual").count();
    if manual >= state.cfg.backups_limit {
        return Err(AppError::unprocessable("You can't generate more than the preset backups"));
    }
    let job_state = state.clone();
    // Runs to the end even if the browser goes away
    let job = tokio::spawn(async move {
        let _guard = job_state.maintenance.try_lock().map_err(|_| None)?;
        let name = new_name(&job_state, "backup", None, ".sql").await;
        dump_to(&job_state.cfg, &name).await.map_err(Some)
    });
    match job.await.map_err(anyhow::Error::from)? {
        Ok(()) => {
            activity::log(&state, &user, &headers, &state.t("Backup created successfully").await, None).await;
            Ok(Json(json!({ "message": state.t("Backup created successfully").await })).into_response())
        }
        Err(None) => Err(busy()),
        Err(Some(reason)) => {
            let msg = format!("{}{}", state.t("Failed to create backup. Error: ").await, reason);
            Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "message": msg }))).into_response())
        }
    }
}

async fn remove(State(state): State<AppState>, user: AuthUser, Path(file): Path<String>) -> AppResult<Json<Value>> {
    user.require(&[PERMISSION])?;
    let path = existing(&state, &file).await?;
    let _guard = state.maintenance.try_lock().map_err(|_| busy())?;
    tokio::fs::remove_file(&path).await.map_err(anyhow::Error::from)?;
    Ok(Json(json!({ "message": state.t("Backup removed successfully").await })))
}

async fn download(State(state): State<AppState>, user: AuthUser, Path(file): Path<String>) -> AppResult<Response> {
    user.require(&[PERMISSION])?;
    let path = existing(&state, &file).await?;
    let f = tokio::fs::File::open(&path).await.map_err(anyhow::Error::from)?;
    let len = f.metadata().await.map_err(anyhow::Error::from)?.len();
    let mut res = Response::new(Body::from_stream(tokio_util::io::ReaderStream::new(f)));
    let h = res.headers_mut();
    let ctype = if file.ends_with(".gz") { "application/gzip" } else { "application/sql" };
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static(ctype));
    h.insert(header::CONTENT_LENGTH, HeaderValue::from(len));
    // valid_name() allows only [A-Za-z0-9._-]
    if let Ok(v) = HeaderValue::from_str(&format!("attachment; filename=\"{file}\"")) {
        h.insert(header::CONTENT_DISPOSITION, v);
    }
    Ok(res)
}

/// Whether a backup's account still exists in the restored data (activity
/// rows must not be credited to someone else).
async fn same_user_exists(state: &AppState, user: &AuthUser) -> bool {
    let email = user.user.get("email").and_then(Value::as_str).unwrap_or("");
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE id = ? AND email = ?")
        .bind(user.id)
        .bind(email)
        .fetch_one(&state.db)
        .await
        .map(|n| n > 0)
        .unwrap_or(false)
}

enum RestoreError {
    Busy,
    Safety(String),
    Import { reason: String, safety: String },
}

async fn restore(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(file): Path<String>) -> AppResult<Response> {
    user.require(&[PERMISSION])?;
    let path = existing(&state, &file).await?;
    let job_state = state.clone();
    let restored_name = file.clone();
    let job = tokio::spawn(async move {
        let state = job_state;
        let _guard = state.maintenance.try_lock().map_err(|_| RestoreError::Busy)?;
        let safety = new_name(&state, "pre-restore", None, ".sql").await;
        dump_to(&state.cfg, &safety).await.map_err(RestoreError::Safety)?;
        let cfg = state.cfg.clone();
        let imported = tokio::task::spawn_blocking(move || import_blocking(&cfg, &path))
            .await
            .unwrap_or_else(|e| Err(format!("restore stopped ({e})")));
        let result = match imported {
            Ok(has_migrations) => {
                // A dump without its own migration history must not inherit
                // the replaced database's: let the schema check adopt it.
                if !has_migrations {
                    if let Err(e) = sqlx::query("DROP TABLE IF EXISTS `migrations`").execute(&state.db).await {
                        tracing::warn!(error = %e, "cannot reset the migration history");
                    }
                }
                crate::bootstrap::run(&state.db, &state.cfg)
                    .await
                    .map(|r| tracing::info!(adopted = r.adopted, migrated = ?r.migrated, "database restored"))
                    .map_err(|e| {
                        tracing::error!(error = %format!("{e:#}"), "restored database could not be prepared");
                        format!("The restored database could not be upgraded: {e}")
                    })
            }
            Err(e) => Err(e),
        };
        // Whatever happened, show what is in the database now
        if let Err(e) = state.settings.reload(&state.db).await {
            tracing::error!(error = ?e, "cannot reload settings after the restore");
        }
        super::settings::reload_translations(&state).await;
        prune(&state.cfg.backups_dir(), "pre-restore-", Some(&restored_name)).await;
        result.map(|_| safety.clone()).map_err(|reason| RestoreError::Import { reason, safety })
    });
    match job.await.map_err(anyhow::Error::from)? {
        Ok(safety) => {
            if same_user_exists(&state, &user).await {
                activity::log(&state, &user, &headers, &state.t("Backup restored successfully").await, None).await;
            }
            Ok(Json(json!({ "message": state.t("Database restored successfully").await, "safety_backup": safety })).into_response())
        }
        Err(RestoreError::Busy) => Err(busy()),
        Err(RestoreError::Safety(reason)) => {
            let errors = format!("{}{}", state.t("Failed to create backup. Error: ").await, reason);
            Ok(failure(&state, errors).await)
        }
        Err(RestoreError::Import { reason, safety }) => {
            let note = state.tp("The database before the restore was saved as :file", &[("file", &safety)]).await;
            Ok(failure(&state, format!("{reason} {note}")).await)
        }
    }
}

async fn failure(state: &AppState, errors: String) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "message": state.t("Something went wrong try again !").await, "errors": errors })))
        .into_response()
}

/* ------------------------------------------------------------------ upload */

/// Temp file removed on drop unless kept.
struct TempPath(Option<PathBuf>);

impl TempPath {
    fn path(&self) -> &FsPath {
        self.0.as_deref().unwrap_or(FsPath::new(""))
    }
    fn keep(mut self) -> PathBuf {
        self.0.take().unwrap_or_default()
    }
}

impl Drop for TempPath {
    fn drop(&mut self) {
        if let Some(p) = self.0.take() {
            if p.is_dir() {
                let _ = std::fs::remove_dir_all(p);
            } else {
                let _ = std::fs::remove_file(p);
            }
        }
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum UploadKind {
    Sql,
    SqlGz,
    Zip,
}

fn upload_kind(file_name: &str) -> Option<UploadKind> {
    let n = file_name.to_ascii_lowercase();
    if n.ends_with(".sql.gz") {
        Some(UploadKind::SqlGz)
    } else if n.ends_with(".sql") {
        Some(UploadKind::Sql)
    } else if n.ends_with(".zip") {
        Some(UploadKind::Zip)
    } else {
        None
    }
}

/// Whether the start of a file reads like a SQL dump (text with statements).
pub fn looks_like_sql(prefix: &[u8]) -> bool {
    let body = prefix.strip_prefix(b"\xEF\xBB\xBF".as_slice()).unwrap_or(prefix);
    if body.is_empty() || body.contains(&0) {
        return false;
    }
    let text = match std::str::from_utf8(body) {
        Ok(t) => t,
        // a multi-byte character cut at the end of the sample is fine
        Err(e) if e.error_len().is_none() => std::str::from_utf8(&body[..e.valid_up_to()]).unwrap_or(""),
        Err(_) => return false,
    };
    let lower = text.to_ascii_lowercase();
    ["create table", "insert into", "drop table", "-- mysql dump", "-- mariadb dump", "lock tables", "alter table"]
        .iter()
        .any(|k| lower.contains(k))
}

/// First bytes of a (possibly gzipped) dump file.
fn sniff_dump(path: &FsPath, gz: bool) -> std::io::Result<Vec<u8>> {
    let file = std::fs::File::open(path)?;
    let mut reader: Box<dyn Read> = if gz { Box::new(flate2::read::MultiGzDecoder::new(BufReader::new(file))) } else { Box::new(file) };
    let mut buf = vec![0u8; SNIFF_BYTES];
    let mut filled = 0;
    while filled < buf.len() {
        let n = reader.read(&mut buf[filled..])?;
        if n == 0 {
            break;
        }
        filled += n;
    }
    buf.truncate(filled);
    Ok(buf)
}

fn is_sql_dump(path: &FsPath, gz: bool) -> bool {
    sniff_dump(path, gz).map(|b| looks_like_sql(&b)).unwrap_or(false)
}

async fn upload(
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    multipart: Result<Multipart, MultipartRejection>,
) -> AppResult<Json<Value>> {
    user.require(&[PERMISSION])?;
    let mut mp = multipart.map_err(|_| AppError::field("file", "The file field is required."))?;
    let tmp_dir = state.cfg.tmp_dir();
    tokio::fs::create_dir_all(&tmp_dir).await.map_err(anyhow::Error::from)?;
    let limit = state.cfg.max_backup_upload;
    let too_large = || AppError::Status(StatusCode::PAYLOAD_TOO_LARGE, tr!("The file is too large.").into());

    let mut received: Option<(UploadKind, TempPath)> = None;
    loop {
        let field = match mp.next_field().await {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(e) if e.status() == StatusCode::PAYLOAD_TOO_LARGE => return Err(too_large()),
            Err(_) => return Err(AppError::bad_request("Upload was interrupted.")),
        };
        let mut field = field;
        if field.name() != Some("file") || received.is_some() {
            continue;
        }
        let Some(file_name) = field.file_name().map(str::to_string) else { continue };
        let kind = upload_kind(&file_name).ok_or_else(|| AppError::field("file", "The file must be a .sql, .sql.gz or .zip file."))?;
        let temp = TempPath(Some(tmp_dir.join(format!("backup-upload-{}.part", crate::util::uuid()))));
        let mut out = tokio::fs::File::create(temp.path()).await.map_err(anyhow::Error::from)?;
        let mut size: u64 = 0;
        loop {
            match field.chunk().await {
                Ok(Some(chunk)) => {
                    size += chunk.len() as u64;
                    if size > limit {
                        return Err(too_large());
                    }
                    out.write_all(&chunk).await.map_err(anyhow::Error::from)?;
                }
                Ok(None) => break,
                Err(e) if e.status() == StatusCode::PAYLOAD_TOO_LARGE => return Err(too_large()),
                Err(_) => return Err(AppError::bad_request("Upload was interrupted.")),
            }
        }
        out.flush().await.map_err(anyhow::Error::from)?;
        drop(out);
        if size == 0 {
            return Err(AppError::field("file", "The file field is required."));
        }
        received = Some((kind, temp));
    }
    let (kind, temp) = received.ok_or_else(|| AppError::field("file", "The file field is required."))?;

    let mut backups: Vec<String> = vec![];
    let mut images = 0usize;
    let mut languages = 0usize;
    let mut skipped = 0usize;
    let message;
    match kind {
        UploadKind::Sql | UploadKind::SqlGz => {
            let gz = kind == UploadKind::SqlGz;
            let p = temp.path().to_path_buf();
            let ok = tokio::task::spawn_blocking(move || is_sql_dump(&p, gz)).await.unwrap_or(false);
            if !ok {
                return Err(AppError::field("file", "The file is not a SQL database dump."));
            }
            let name = new_name(
                &state,
                "uploaded",
                Some(&crate::util::random_string(6).to_ascii_lowercase()),
                if gz { ".sql.gz" } else { ".sql" },
            )
            .await;
            let dest = state.cfg.backups_dir().join(&name);
            tokio::fs::create_dir_all(state.cfg.backups_dir()).await.map_err(anyhow::Error::from)?;
            move_file(&temp.keep(), &dest).await?;
            backups.push(name);
            message = state.t("Backup uploaded successfully").await;
        }
        UploadKind::Zip => {
            let limits = ZipLimits::for_upload(limit);
            let staging = TempPath(Some(tmp_dir.join(format!("zip-{}", crate::util::uuid()))));
            let zip_path = temp.path().to_path_buf();
            let stage_dir = staging.path().to_path_buf();
            let plan = tokio::task::spawn_blocking(move || read_archive(&zip_path, &stage_dir, &limits))
                .await
                .map_err(anyhow::Error::from)?
                .map_err(|e| match e {
                    ZipError::Invalid(msg) => AppError::field("file", msg),
                    ZipError::Io(e) => AppError::Other(e.into()),
                })?;
            drop(temp);
            if plan.images.is_empty() && plan.dumps.is_empty() && plan.languages.is_empty() {
                return Err(AppError::field("file", "The archive has no backups, images or translations."));
            }
            skipped = plan.skipped;
            // images into uploads
            let uploads = state.cfg.uploads_dir();
            for (staged, rel) in &plan.images {
                if let Some(dest) = crate::uploads::safe_join(&uploads, rel) {
                    if let Some(parent) = dest.parent() {
                        tokio::fs::create_dir_all(parent).await.map_err(anyhow::Error::from)?;
                    }
                    move_file(staged, &dest).await?;
                    images += 1;
                }
            }
            // dumps into backups
            tokio::fs::create_dir_all(state.cfg.backups_dir()).await.map_err(anyhow::Error::from)?;
            for (staged, gz) in &plan.dumps {
                let name = new_name(
                    &state,
                    "uploaded",
                    Some(&crate::util::random_string(6).to_ascii_lowercase()),
                    if *gz { ".sql.gz" } else { ".sql" },
                )
                .await;
                move_file(staged, &state.cfg.backups_dir().join(&name)).await?;
                backups.push(name);
            }
            // translations, keeping every key the app needs
            let shipped = crate::i18n::Lang::default_en();
            for (locale, mut map) in plan.languages {
                for (k, v) in &shipped {
                    if !map.contains_key(k) {
                        map.insert(k.clone(), if locale == "en" { v.clone() } else { Value::from(k.clone()) });
                    }
                }
                state.lang.write(&locale, &map).await?;
                languages += 1;
            }
            drop(staging);
            message = state.t("Archive imported successfully").await;
        }
    }
    activity::log(&state, &user, &headers, &state.t("Backup uploaded successfully").await, None).await;
    Ok(Json(json!({ "message": message, "backups": backups, "images": images, "languages": languages, "skipped": skipped })))
}

async fn move_file(from: &FsPath, to: &FsPath) -> AppResult<()> {
    if tokio::fs::rename(from, to).await.is_err() {
        tokio::fs::copy(from, to).await.map_err(anyhow::Error::from)?;
        let _ = tokio::fs::remove_file(from).await;
    }
    Ok(())
}

/* ------------------------------------------------------------- zip import */

pub struct ZipLimits {
    pub max_entries: usize,
    pub max_image: u64,
    pub max_json: u64,
    pub max_sql: u64,
    pub max_total: u64,
    pub max_languages: usize,
}

impl ZipLimits {
    fn for_upload(max_upload: u64) -> Self {
        let big = max_upload.saturating_mul(10).max(1 << 30);
        Self { max_entries: 20_000, max_image: 20 << 20, max_json: 5 << 20, max_sql: big, max_total: big, max_languages: 100 }
    }
}

#[derive(Debug)]
pub enum ZipError {
    /// Message for the user (422)
    Invalid(&'static str),
    Io(std::io::Error),
}

impl From<std::io::Error> for ZipError {
    fn from(e: std::io::Error) -> Self {
        ZipError::Io(e)
    }
}

#[derive(Default, Debug)]
pub struct ZipPlan {
    /// staged file, destination relative to the uploads folder
    pub images: Vec<(PathBuf, String)>,
    /// staged dump, gzipped
    pub dumps: Vec<(PathBuf, bool)>,
    pub languages: Vec<(String, Map<String, Value>)>,
    pub skipped: usize,
}

const IMAGE_EXTS: [&str; 8] = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"];
/// Upload folders of earlier releases (for archives wrapped in an extra folder)
const KNOWN_FOLDERS: [&str; 6] = ["appearance", "avatar", "food-items", "repairing", "food-categories", "media"];

/// Path components of an archive entry, or None when the name is unsafe
/// (absolute, drive letter, "..", empty parts, control characters).
pub fn entry_components(raw: &str) -> Option<Vec<String>> {
    if raw.is_empty() || raw.contains('\0') || raw.chars().any(char::is_control) {
        return None;
    }
    let norm = raw.replace('\\', "/");
    if norm.starts_with('/') || norm.as_bytes().get(1) == Some(&b':') {
        return None;
    }
    let trimmed = norm.strip_suffix('/').unwrap_or(&norm);
    let parts: Vec<String> = trimmed.split('/').map(str::to_string).collect();
    if parts.iter().any(|p| p.is_empty() || p == "." || p == "..") {
        return None;
    }
    Some(parts)
}

fn ext_of(name: &str) -> String {
    name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default()
}

/// Locale codes accepted for translation files (xx, xxx, xx-YY, xx_Hant...).
pub fn locale_file(name: &str) -> Option<String> {
    let locale = name.strip_suffix(".json")?;
    let mut parts = locale.split(['-', '_']);
    let lang = parts.next()?;
    let ok = (2..=3).contains(&lang.len())
        && lang.chars().all(|c| c.is_ascii_alphabetic())
        && parts.all(|p| (2..=8).contains(&p.len()) && p.chars().all(|c| c.is_ascii_alphanumeric()));
    (ok && crate::i18n::Lang::valid_locale(locale)).then(|| locale.to_string())
}

/// Where an image goes under uploads, from the layouts of the old server.
fn marker_rest(parts: &[String]) -> Option<Vec<String>> {
    let markers: [&[&str]; 3] = [&["storage", "app", "public"], &["public", "storage"], &["uploads"]];
    for i in 0..parts.len() {
        for m in markers {
            if parts.len() > i + m.len() && parts[i..i + m.len()].iter().zip(m.iter()).all(|(a, b)| a == b) {
                return Some(parts[i + m.len()..].to_vec());
            }
        }
    }
    None
}

fn valid_upload_rel(rest: &[String]) -> bool {
    rest.len() >= 2 && rest.iter().all(|p| !p.starts_with('.') && !p.contains(':') && p.len() <= 200)
}

enum Staged {
    Image(PathBuf, Vec<String>),
    Dump(PathBuf, bool),
}

/// Read a files archive from the old server into `stage` and work out where
/// each file goes. Blocking: run it on a blocking thread.
pub fn read_archive(zip_path: &FsPath, stage: &FsPath, limits: &ZipLimits) -> Result<ZipPlan, ZipError> {
    let file = std::fs::File::open(zip_path)?;
    let mut archive =
        zip::ZipArchive::new(BufReader::new(file)).map_err(|_| ZipError::Invalid(tr!("The file is not a valid zip archive.")))?;
    if archive.len() > limits.max_entries {
        return Err(ZipError::Invalid(tr!("The archive has too many files.")));
    }
    std::fs::create_dir_all(stage)?;
    let mut plan = ZipPlan::default();
    let mut staged: Vec<Staged> = vec![];
    let mut total: u64 = 0;

    for i in 0..archive.len() {
        let mut entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(_) => {
                plan.skipped += 1; // encrypted or unsupported compression
                continue;
            }
        };
        if entry.is_dir() {
            continue;
        }
        let raw = match entry.name() {
            Ok(n) => n.to_string(),
            Err(_) => {
                plan.skipped += 1;
                continue;
            }
        };
        let is_link = entry.is_symlink() || entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000);
        let parts = match entry_components(&raw) {
            Some(p) if !is_link && entry.enclosed_name().is_some() => p,
            _ => {
                tracing::warn!(entry = %raw.chars().take(200).collect::<String>(), "unsafe archive entry skipped");
                plan.skipped += 1;
                continue;
            }
        };
        let file_name = parts.last().cloned().unwrap_or_default();
        if parts.iter().any(|p| p == "__MACOSX") || file_name.starts_with('.') {
            continue;
        }
        let lower = file_name.to_ascii_lowercase();
        let ext = ext_of(&lower);
        enum Want {
            Image,
            Lang(String),
            Dump(bool),
        }
        let want = if lower.ends_with(".sql.gz") {
            Want::Dump(true)
        } else if ext == "sql" {
            Want::Dump(false)
        } else if IMAGE_EXTS.contains(&ext.as_str()) {
            Want::Image
        } else if ext == "json" && parts.len() >= 2 && parts[parts.len() - 2] == "lang" {
            match locale_file(&file_name) {
                Some(l) => Want::Lang(l),
                None => {
                    plan.skipped += 1;
                    continue;
                }
            }
        } else {
            plan.skipped += 1;
            continue;
        };
        let cap = match want {
            Want::Image => limits.max_image,
            Want::Lang(_) => limits.max_json,
            Want::Dump(_) => limits.max_sql,
        };
        if entry.size() > cap {
            plan.skipped += 1;
            continue;
        }
        if total.saturating_add(entry.size()) > limits.max_total {
            return Err(ZipError::Invalid(tr!("The archive is too large when unpacked.")));
        }
        // Real bytes are counted too: sizes in the archive can lie
        let staged_path = stage.join(format!("{i}.bin"));
        let written = {
            let mut out = std::io::BufWriter::new(std::fs::File::create(&staged_path)?);
            let n = std::io::copy(&mut (&mut entry).take(cap + 1), &mut out);
            out.flush()?;
            match n {
                Ok(n) => n,
                Err(_) => {
                    let _ = std::fs::remove_file(&staged_path);
                    plan.skipped += 1;
                    continue;
                }
            }
        };
        total = total.saturating_add(written);
        if total > limits.max_total {
            return Err(ZipError::Invalid(tr!("The archive is too large when unpacked.")));
        }
        if written > cap {
            let _ = std::fs::remove_file(&staged_path);
            plan.skipped += 1;
            continue;
        }
        let valid = match &want {
            Want::Image => image_content_ok(&staged_path, &ext),
            Want::Dump(gz) => is_sql_dump(&staged_path, *gz),
            Want::Lang(_) => true,
        };
        if !valid {
            let _ = std::fs::remove_file(&staged_path);
            plan.skipped += 1;
            continue;
        }
        match want {
            Want::Image => staged.push(Staged::Image(staged_path, parts)),
            Want::Dump(gz) => staged.push(Staged::Dump(staged_path, gz)),
            Want::Lang(locale) => {
                let text = std::fs::read(&staged_path)?;
                let _ = std::fs::remove_file(&staged_path);
                let text = text.strip_prefix(b"\xEF\xBB\xBF".as_slice()).unwrap_or(&text);
                match serde_json::from_slice::<Map<String, Value>>(text) {
                    Ok(map) if map.values().all(Value::is_string) && plan.languages.len() < limits.max_languages => {
                        plan.languages.retain(|(l, _)| l != &locale);
                        plan.languages.push((locale, map));
                    }
                    _ => plan.skipped += 1,
                }
            }
        }
    }

    // Images: use the old server's storage layout when the archive has it,
    // otherwise <folder>/<file> (optionally inside one wrapping folder).
    let images: Vec<(PathBuf, Vec<String>)> = staged
        .iter()
        .filter_map(|s| match s {
            Staged::Image(p, parts) => Some((p.clone(), parts.clone())),
            _ => None,
        })
        .collect();
    let any_marker = images.iter().any(|(_, parts)| marker_rest(parts).is_some());
    let common_wrapper = {
        let firsts: std::collections::HashSet<&str> = images.iter().map(|(_, p)| p[0].as_str()).collect();
        firsts.len() == 1 && images.iter().all(|(_, p)| p.len() >= 3) && firsts.iter().all(|f| !KNOWN_FOLDERS.contains(f))
    };
    for (path, parts) in images {
        let rest = if any_marker {
            marker_rest(&parts)
        } else if common_wrapper {
            Some(parts[1..].to_vec())
        } else {
            Some(parts)
        };
        match rest.filter(|r| valid_upload_rel(r)) {
            Some(r) => plan.images.push((path, r.join("/"))),
            None => {
                let _ = std::fs::remove_file(&path);
                plan.skipped += 1;
            }
        }
    }
    for s in staged {
        if let Staged::Dump(p, gz) = s {
            plan.dumps.push((p, gz));
        }
    }
    Ok(plan)
}

/// The staged file really is an image of an accepted kind.
fn image_content_ok(path: &FsPath, ext: &str) -> bool {
    let mut head = vec![0u8; 4096];
    let n = std::fs::File::open(path).and_then(|mut f| f.read(&mut head)).unwrap_or(0);
    head.truncate(n);
    if ext == "svg" {
        let text = String::from_utf8_lossy(&head).to_ascii_lowercase();
        return !head.contains(&0) && text.contains("<svg");
    }
    crate::uploads::image_ext(&head).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert!(valid_name("backup-2026-10-18_21-40-00.sql"));
        assert!(valid_name("uploaded-2026-10-18_21-40-00-ab12cd.sql.gz"));
        assert!(!valid_name("../x.sql"));
        assert!(!valid_name("x.sql/../../etc"));
        assert!(!valid_name(".hidden.sql"));
        assert!(!valid_name("a b.sql"));
        assert!(!valid_name("x.txt"));
        assert_eq!(kind_of("pre-restore-x.sql"), "pre-restore");
        assert_eq!(kind_of("uploaded-x.sql"), "uploaded");
    }

    #[test]
    fn sizes() {
        assert_eq!(size_mb(1_310_720), "1.25MB");
        assert_eq!(size_mb(0), "0.00MB");
        assert_eq!(size_mb(2_000 * 1_048_576), "2,000.00MB");
    }

    #[test]
    fn filters_dumps() {
        let input = b"/*M!999999\\- enable the sandbox mode */ \n-- MariaDB dump\nCREATE DATABASE `other`;\nUSE `other`;\nCREATE TABLE `t` (`a` int) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;\n/*!40101 SET collation_connection = utf8mb4_de_pb_0900_as_cs */;\nINSERT INTO `t` VALUES ('utf8mb4_0900_ai_ci');\n";
        let mut out = Vec::new();
        assert!(!filter_dump(&input[..], &mut out).unwrap());
        let s = String::from_utf8(out).unwrap();
        assert!(!s.contains("sandbox"));
        assert!(!s.contains("USE `other`"));
        assert!(!s.contains("CREATE DATABASE"));
        assert!(s.contains("COLLATE=utf8mb4_unicode_ci;"));
        assert!(s.contains("collation_connection = utf8mb4_unicode_ci */"));
        assert!(s.contains("INSERT INTO `t` VALUES ('utf8mb4_0900_ai_ci');"));
        // the sandbox line is only removed at the very start
        let mut out = Vec::new();
        filter_dump(&b"SELECT 1;\n/*M!999999\\- enable the sandbox mode */\n"[..], &mut out).unwrap();
        assert!(String::from_utf8(out).unwrap().contains("sandbox"));
        let mut out = Vec::new();
        assert!(filter_dump(&b"DROP TABLE IF EXISTS `migrations`;\nCREATE TABLE `migrations` (\n"[..], &mut out).unwrap());
    }

    #[test]
    fn sniffs_sql() {
        assert!(looks_like_sql(b"-- MariaDB dump 10.19\n"));
        assert!(looks_like_sql(b"\xEF\xBB\xBFCREATE TABLE x (a int);"));
        assert!(!looks_like_sql(b"PK\x03\x04\0\0"));
        assert!(!looks_like_sql(b"hello world"));
        assert!(!looks_like_sql(b""));
    }

    #[test]
    fn entry_paths() {
        assert!(entry_components("../etc/passwd").is_none());
        assert!(entry_components("a/../../b.png").is_none());
        assert!(entry_components("/abs/x.png").is_none());
        assert!(entry_components("C:\\x\\y.png").is_none());
        assert!(entry_components("a//b.png").is_none());
        assert!(entry_components("a\\..\\b.png").is_none());
        assert_eq!(entry_components("food-items/a.png").unwrap(), vec!["food-items", "a.png"]);
        assert_eq!(
            marker_rest(&["site".into(), "storage".into(), "app".into(), "public".into(), "avatar".into(), "x.png".into()]).unwrap(),
            vec!["avatar", "x.png"]
        );
        assert_eq!(
            marker_rest(&["public".into(), "storage".into(), "food-items".into(), "x.png".into()]).unwrap(),
            vec!["food-items", "x.png"]
        );
        assert!(marker_rest(&["food-items".into(), "x.png".into()]).is_none());
    }

    #[test]
    fn locales() {
        assert_eq!(locale_file("ar.json").as_deref(), Some("ar"));
        assert_eq!(locale_file("en-up.json").as_deref(), Some("en-up"));
        assert_eq!(locale_file("pt_BR.json").as_deref(), Some("pt_BR"));
        assert!(locale_file("validation.json").is_none());
        assert!(locale_file("../x.json").is_none());
        assert!(locale_file("x.php").is_none());
    }

    #[test]
    fn tool_errors_are_summarized() {
        assert_eq!(tool_summary("ERROR 1064 (42000) at line 12: You have an error near 'secret'"), "ERROR 1064 (42000) at line 12");
        assert_eq!(tool_summary("mysqldump: Got error: 1045: \"Access denied for user\""), "Got error: 1045");
        assert_eq!(tool_summary("something else"), "see the server log for details");
    }

    fn build_zip(entries: &[(&str, Vec<u8>)]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in entries {
            w.start_file(*name, opts).unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    fn limits() -> ZipLimits {
        ZipLimits { max_entries: 10, max_image: 1000, max_json: 1000, max_sql: 5000, max_total: 6000, max_languages: 5 }
    }

    fn run(bytes: &[u8]) -> (Result<ZipPlan, ZipError>, PathBuf) {
        let dir = std::env::temp_dir().join(format!("pos-zip-test-{}", crate::util::uuid()));
        std::fs::create_dir_all(&dir).unwrap();
        let zip_path = dir.join("a.zip");
        std::fs::write(&zip_path, bytes).unwrap();
        let stage = dir.join("stage");
        (read_archive(&zip_path, &stage, &limits()), dir)
    }

    fn png(len: usize) -> Vec<u8> {
        let mut v = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        v.resize(len, 0);
        v
    }

    #[test]
    fn archive_limits() {
        let sql = |n: usize| {
            let mut v = b"-- MariaDB dump\nCREATE TABLE t (a int);\n".to_vec();
            v.resize(n, b' ');
            v
        };
        // per-entry limit: the big image is skipped, the rest imported
        let (plan, dir) = run(&build_zip(&[
            ("food-items/big.png", png(3000)),
            ("food-items/ok.png", png(500)),
            ("x/lang/ar.json", b"{\"a\":\"b\"}".to_vec()),
        ]));
        let plan = plan.unwrap();
        assert_eq!(plan.images.len(), 1);
        assert_eq!(plan.images[0].1, "food-items/ok.png");
        assert_eq!(plan.languages.len(), 1);
        assert_eq!(plan.skipped, 1);
        std::fs::remove_dir_all(dir).unwrap();
        // total unpacked size
        let (plan, dir) = run(&build_zip(&[("a.sql", sql(4000)), ("b.sql", sql(4000))]));
        assert!(matches!(plan, Err(ZipError::Invalid(_))));
        std::fs::remove_dir_all(dir).unwrap();
        // entry count
        let many: Vec<(String, Vec<u8>)> = (0..11).map(|i| (format!("f{i}.txt"), vec![])).collect();
        let refs: Vec<(&str, Vec<u8>)> = many.iter().map(|(n, d)| (n.as_str(), d.clone())).collect();
        let (plan, dir) = run(&build_zip(&refs));
        assert!(matches!(plan, Err(ZipError::Invalid(_))));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn archive_with_lying_sizes() {
        // Declares 100 bytes but unpacks to 3000: never written past the limit
        let mut bytes = build_zip(&[("food-items/bomb.png", png(3000))]);
        let patch = |bytes: &mut Vec<u8>, sig: &[u8; 4], offset: usize| {
            let pos = bytes.windows(4).position(|w| w == sig).unwrap();
            bytes[pos + offset..pos + offset + 4].copy_from_slice(&100u32.to_le_bytes());
        };
        patch(&mut bytes, b"PK\x03\x04", 22);
        patch(&mut bytes, b"PK\x01\x02", 24);
        let (plan, dir) = run(&bytes);
        let plan = plan.unwrap();
        assert!(plan.images.is_empty());
        assert_eq!(plan.skipped, 1);
        let leftovers = std::fs::read_dir(dir.join("stage")).map(|d| d.count()).unwrap_or(0);
        assert_eq!(leftovers, 0);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
