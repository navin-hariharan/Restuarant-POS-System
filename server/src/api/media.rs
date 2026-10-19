//! Uploaded files kept in the `media` table: public images (served from
//! /storage) and private attachments (only through the download route).

use crate::{
    auth::AuthUser,
    db::RowExt,
    error::{AppError, AppResult},
    input::Input,
    query::Sql,
    state::AppState,
    uploads::safe_join,
};
use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderValue},
    response::Response,
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Map, Value};
use std::path::PathBuf;
use tokio_util::io::ReaderStream;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/files/save", post(store))
        .route("/files/attachments", post(attachment))
        .route("/files/download/{uuid}", get(download))
        .route("/files/{media}", get(show))
}

/// Largest image accepted by /files/save (5000 KB, as before).
const MAX_IMAGE_KB: usize = 5000;

/// Folder of a storage disk: "public" files are the served uploads, anything
/// else stays private under the data folder.
fn disk_root(state: &AppState, disk: &str) -> PathBuf {
    if disk == "public" {
        state.cfg.uploads_dir()
    } else {
        state.cfg.data_dir.join("private")
    }
}

fn file_path(state: &AppState, r: &Map<String, Value>) -> Option<PathBuf> {
    let rel = format!("{}/{}", r.str("path").trim_matches('/'), r.str("server_name"));
    safe_join(&disk_root(state, &r.str("disk")), &rel)
}

fn file_json(state: &AppState, r: &Map<String, Value>) -> Value {
    let url = if r.str("disk") == "public" {
        Value::from(state.storage_url(&format!("{}/{}", r.str("path").trim_matches('/'), r.str("server_name"))))
    } else {
        Value::Null
    };
    json!({
        "id": r.val("id"),
        "uuid": r.val("uuid"),
        "name": r.val("name"),
        "size": r.val("size"),
        "mime": r.val("mime"),
        "extension": r.val("extension"),
        "url": url,
        "download": format!("{}/api/v1/files/download/{}", state.cfg.app_url, r.str("uuid")),
    })
}

fn clip(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

fn client_extension(name: &str) -> String {
    std::path::Path::new(name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

fn file_required(input: &Input) -> AppResult<()> {
    if input.file("file").is_none() {
        return Err(AppError::field("file", "The file field is required."));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn insert(
    state: &AppState,
    uuid: &str,
    name: &str,
    size: usize,
    mime: &str,
    ext: &str,
    disk: &str,
    path: &str,
    server_name: &str,
    user_id: i64,
) -> AppResult<Map<String, Value>> {
    let now = state.settings.get().await.now();
    let res = sqlx::query(
        "INSERT INTO media (uuid, extension, name, mime, disk, size, server_name, path, user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(uuid)
    .bind(clip(ext, 191))
    .bind(clip(name, 191))
    .bind(clip(mime, 191))
    .bind(disk)
    .bind(i64::try_from(size).unwrap_or(i64::MAX))
    .bind(server_name)
    .bind(path)
    .bind(user_id)
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await?;
    Sql::new("SELECT * FROM media WHERE id = ?")
        .push_args("", [res.last_insert_id() as i64])
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(AppError::not_found)
}

fn image_mime(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/vnd.microsoft.icon",
        _ => "application/octet-stream",
    }
}

/// POST /files/save: a public image.
async fn store(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    file_required(&input)?;
    let Some(file) = input.file("file") else { return Err(AppError::field("file", "The file field is required.")) };
    let bytes = file.bytes().await.map_err(anyhow::Error::from)?;
    let sniffed = crate::uploads::image_ext(&bytes);
    let mut errors = crate::error::Errors::default();
    if sniffed.is_none() {
        errors.add("file", "The file must be an image.");
    }
    if file.size > MAX_IMAGE_KB * 1024 {
        errors.add("file", "The file may not be greater than 5000 kilobytes.");
    }
    errors.check()?;
    let ext = sniffed.unwrap_or("bin");
    let now = state.settings.get().await.now();
    let folder = now.format("%Y/%m").to_string();
    let server_name = format!("{}.{}", crate::util::random_string(40), ext);
    let dest = state.cfg.uploads_dir().join(&folder).join(&server_name);
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(anyhow::Error::from)?;
    }
    tokio::fs::write(&dest, &bytes).await.map_err(anyhow::Error::from)?;
    let uuid = crate::util::uuid();
    let row = insert(&state, &uuid, &file.file_name, file.size, image_mime(ext), &client_extension(&file.file_name), "public", &folder, &server_name, user.id).await;
    match row {
        Ok(r) => Ok(Json(file_json(&state, &r))),
        Err(e) => {
            let _ = tokio::fs::remove_file(&dest).await;
            Err(e)
        }
    }
}

/// POST /files/attachments: any file, kept private.
async fn attachment(State(state): State<AppState>, user: AuthUser, mut input: Input) -> AppResult<Json<Value>> {
    file_required(&input)?;
    let Some(file) = input.take_file("file") else { return Err(AppError::field("file", "The file field is required.")) };
    let now = state.settings.get().await.now();
    let folder = format!("attachments/{}", now.format("%Y/%m"));
    let server_name = crate::util::random_string(32);
    let dest = disk_root(&state, "private").join(&folder).join(&server_name);
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(anyhow::Error::from)?;
    }
    // Move out of the temp folder (copy when it is another file system)
    if tokio::fs::rename(&file.path, &dest).await.is_err() {
        tokio::fs::copy(&file.path, &dest).await.map_err(anyhow::Error::from)?;
    }
    let mime = mime_guess::from_path(&file.file_name).first_or_octet_stream().to_string();
    let uuid = crate::util::uuid();
    match insert(&state, &uuid, &file.file_name, file.size, &mime, &client_extension(&file.file_name), "private", &folder, &server_name, user.id).await {
        Ok(r) => Ok(Json(file_json(&state, &r))),
        Err(e) => {
            let _ = tokio::fs::remove_file(&dest).await;
            tracing::error!(error = %e, "could not save the attachment");
            Err(AppError::Status(axum::http::StatusCode::INTERNAL_SERVER_ERROR, tr!("An error occurred while saving data").into()))
        }
    }
}

async fn show(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<Value>> {
    let id: i64 = id.parse().map_err(|_| AppError::not_found())?;
    let row = Sql::new("SELECT * FROM media WHERE id = ?").push_args("", [id]).fetch_optional(&state.db).await?.ok_or_else(AppError::not_found)?;
    Ok(Json(file_json(&state, &row)))
}

/// `attachment` Content-Disposition with an ASCII fallback and the UTF-8 name.
fn disposition(name: &str) -> String {
    let ascii: String = name
        .chars()
        .map(|c| if c.is_ascii_graphic() && c != '"' && c != '\\' && c != '%' || c == ' ' { c } else { '_' })
        .collect();
    let encoded: String = name
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    let ascii = if ascii.trim().is_empty() { "download".to_string() } else { ascii };
    format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{encoded}")
}

async fn download(State(state): State<AppState>, Path(uuid): Path<String>) -> AppResult<Response> {
    let row = Sql::new("SELECT * FROM media WHERE uuid = ? LIMIT 1").push_args("", [uuid]).fetch_optional(&state.db).await?.ok_or_else(AppError::not_found)?;
    let path = file_path(&state, &row).ok_or_else(AppError::not_found)?;
    let meta = tokio::fs::metadata(&path).await.map_err(|_| AppError::not_found())?;
    if !meta.is_file() {
        return Err(AppError::not_found());
    }
    let file = tokio::fs::File::open(&path).await.map_err(|_| AppError::not_found())?;
    let mut res = Response::new(Body::from_stream(ReaderStream::new(file)));
    let h = res.headers_mut();
    let mime = row.opt_str("mime").filter(|m| m.parse::<mime_guess::mime::Mime>().is_ok()).unwrap_or_else(|| "application/octet-stream".into());
    h.insert(header::CONTENT_TYPE, HeaderValue::from_str(&mime).unwrap_or(HeaderValue::from_static("application/octet-stream")));
    h.insert(header::CONTENT_LENGTH, HeaderValue::from(meta.len()));
    h.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&disposition(&row.str("name"))).unwrap_or(HeaderValue::from_static("attachment")),
    );
    h.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'none'; sandbox"));
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disposition_is_safe() {
        assert_eq!(disposition("a b.pdf"), "attachment; filename=\"a b.pdf\"; filename*=UTF-8''a%20b.pdf");
        let d = disposition("x\"\r\n.txt");
        assert!(!d.contains('\r') && !d.contains('\n'));
        assert!(disposition("résumé.pdf").contains("filename*=UTF-8''r%C3%A9sum%C3%A9.pdf"));
    }
}
