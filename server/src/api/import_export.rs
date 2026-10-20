//! Import (CSV) and export (CSV, XLSX, XLS, HTML) of master data.

pub mod export;
pub mod import;
pub mod xls;

use crate::{
    activity,
    auth::AuthUser,
    error::{AppError, AppResult, Errors},
    input::Input,
    state::AppState,
};
use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde_json::{json, Value};

pub fn router() -> Router<AppState> {
    Router::new().route("/admin/exports", post(export_data)).route("/admin/imports", post(import_data))
}

async fn export_data(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Response> {
    user.require(&["import_exports"])?;
    let format = match input.get("format") {
        Some(Value::String(f)) if ["csv", "xlsx", "xls", "html"].contains(&f.as_str()) => f.clone(),
        _ => return Err(AppError::unprocessable("Unsupported export format")),
    };
    let key = input.str("resource").unwrap_or_default();
    let res = export::resource(&key).ok_or_else(|| AppError::unprocessable("please specify resource to export"))?;
    let rows = export::rows(&state, &res).await?;
    let title = res.file.to_string();
    let fmt = format.clone();
    let built = tokio::task::spawn_blocking(move || -> anyhow::Result<Option<Vec<u8>>> {
        Ok(match fmt.as_str() {
            "csv" => Some(export::csv(&export::guarded(rows))),
            "xlsx" => Some(export::xlsx(&export::guarded(rows))?),
            "xls" => xls::write("Worksheet", &export::guarded(rows)),
            _ => Some(export::html(&title, &rows)),
        })
    })
    .await
    .map_err(anyhow::Error::from)??;
    let body = built.ok_or_else(|| AppError::unprocessable("Too many rows for an XLS file, please export as XLSX or CSV."))?;
    let content_type = match format.as_str() {
        "csv" => "text/csv; charset=UTF-8",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xls" => "application/vnd.ms-excel",
        _ => "text/html; charset=UTF-8",
    };
    Ok((
        [
            (header::CONTENT_TYPE, content_type.to_string()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename={}.{}", res.file, format)),
            (header::CACHE_CONTROL, "no-store".to_string()),
        ],
        body,
    )
        .into_response())
}

/// True when the upload looks like plain text (a CSV), not a binary file.
fn looks_like_text(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(8192)];
    !head.is_empty() && !head.contains(&0)
}

async fn import_data(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, mut input: Input) -> AppResult<Response> {
    user.require(&["import_exports"])?;
    let mut errors = Errors::default();
    if !input.has("resource") {
        errors.add("resource", "The resource field is required.");
    }
    let file = input.take_file("file");
    let mut bytes = Vec::new();
    match &file {
        None if input.has("file") => errors.add("file", "The file must be a file."),
        None => errors.add("file", "The file field is required."),
        Some(f) if f.size > import::MAX_BYTES => errors.add("file", "The file may not be greater than 10240 kilobytes."),
        Some(f) => {
            bytes = f.bytes().await.map_err(anyhow::Error::from)?;
            if !looks_like_text(&bytes) {
                errors.add("file", "The file must be a file of type csv, txt.");
            }
        }
    }
    errors.check()?;

    let key = input.str("resource").unwrap_or_default();
    let spec = import::spec(&key).ok_or_else(|| AppError::unprocessable("please specify resource to import"))?;
    let rows = tokio::task::spawn_blocking(move || import::rows(&String::from_utf8_lossy(&bytes))).await.map_err(anyhow::Error::from)?;
    if rows.len() > import::MAX_ROWS {
        return Err(AppError::field("file", format!("The file may not contain more than {} rows.", import::MAX_ROWS)));
    }

    let now = state.settings.get().await.now();
    let mut tx = state.db.begin().await?;
    for (i, row) in rows.iter().enumerate() {
        let failures = import::validate(&mut tx, &spec, row).await?;
        if !failures.is_empty() {
            drop(tx); // rolls back the rows inserted so far
            return Ok(row_errors(&state, i + 2, failures).await);
        }
        import::insert(&mut tx, &key, row, now).await?;
    }
    tx.commit().await?;

    let message = state.t("Data imported successfully").await;
    activity::log(&state, &user, &headers, &message, None).await;
    Ok(Json(json!({ "message": message })).into_response())
}

/// 422 listing each failure of the first bad row ("There was an error on row 3. ...").
async fn row_errors(state: &AppState, row: usize, failures: Vec<import::Failure>) -> Response {
    let row_text = row.to_string();
    let mut list = Vec::with_capacity(failures.len());
    let mut first = String::new();
    for (i, f) in failures.iter().enumerate() {
        let max = f.max.map(|m| m.to_string()).unwrap_or_default();
        let msg = state.tp(f.template, &[("attribute", &f.attribute), ("max", &max)]).await;
        if i == 0 {
            let qualified = format!("{row}.{}", f.attribute);
            first = state.tp(f.template, &[("attribute", &qualified), ("max", &max)]).await;
        }
        let line = state.tp("There was an error on row :row. :message", &[("row", &row_text), ("message", &msg)]).await;
        list.push(json!([line]));
    }
    let message = match failures.len() {
        0 | 1 => first,
        2 => format!("{first} (and 1 more error)"),
        n => format!("{first} (and {} more errors)", n - 1),
    };
    (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({ "message": message, "errors": list }))).into_response()
}
