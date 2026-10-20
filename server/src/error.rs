//! API errors. The JSON shapes are what the web app expects:
//!   422 {"message": "...", "errors": {"field": ["..."]}}
//!   other {"message": "..."}

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use indexmap_like::FieldErrors;
use serde_json::json;

pub type AppResult<T> = Result<T, AppError>;

/// Marks an error response whose `message` / `errors` are English keys; the
/// `translate_errors` middleware puts them in the app's language.
#[derive(Debug, Clone, Copy)]
pub struct Translate;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("validation failed")]
    Validation(FieldErrors),
    /// 4xx with a message for the user
    #[error("{1}")]
    Status(StatusCode, String),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl AppError {
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self::Status(StatusCode::BAD_REQUEST, msg.into())
    }
    pub fn unauthenticated() -> Self {
        Self::Status(StatusCode::UNAUTHORIZED, tr!("Unauthenticated.").into())
    }
    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::Status(StatusCode::FORBIDDEN, msg.into())
    }
    pub fn not_found() -> Self {
        Self::Status(StatusCode::NOT_FOUND, tr!("Not found.").into())
    }
    pub fn not_acceptable(msg: impl Into<String>) -> Self {
        Self::Status(StatusCode::NOT_ACCEPTABLE, msg.into())
    }
    pub fn conflict(msg: impl Into<String>) -> Self {
        Self::Status(StatusCode::CONFLICT, msg.into())
    }
    /// 422 with a single field error (the message is also the top-level message)
    pub fn field(field: &str, msg: impl Into<String>) -> Self {
        let mut e = FieldErrors::default();
        e.add(field, msg);
        Self::Validation(e)
    }
    /// 429 with a message for the user
    pub fn too_many(msg: impl Into<String>) -> Self {
        Self::Status(StatusCode::TOO_MANY_REQUESTS, msg.into())
    }
    /// 422 without field errors
    pub fn unprocessable(msg: impl Into<String>) -> Self {
        Self::Status(StatusCode::UNPROCESSABLE_ENTITY, msg.into())
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let mut res = self.render();
        res.extensions_mut().insert(Translate);
        res
    }
}

impl AppError {
    fn render(self) -> Response {
        match self {
            AppError::Validation(errors) => {
                // As the earlier API: "The name field is required. (and 2 more errors)"
                let first = errors.first().unwrap_or("The given data was invalid.").to_string();
                let message = match errors.count() {
                    0 | 1 => first,
                    2 => format!("{first} (and 1 more error)"),
                    n => format!("{first} (and {} more errors)", n - 1),
                };
                (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({ "message": message, "errors": errors.to_json() }))).into_response()
            }
            AppError::Status(code, message) => (code, Json(json!({ "message": message }))).into_response(),
            AppError::Db(sqlx::Error::RowNotFound) => (StatusCode::NOT_FOUND, Json(json!({ "message": "Not found." }))).into_response(),
            AppError::Db(e) => {
                tracing::error!(error = %e, "database error");
                (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "message": "Server Error" }))).into_response()
            }
            AppError::Other(e) => {
                tracing::error!(error = ?e, "internal error");
                (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "message": "Server Error" }))).into_response()
            }
        }
    }
}

/// Field error collection keeping insertion order (first error = top message).
pub mod indexmap_like {
    use serde_json::{Map, Value};

    #[derive(Debug, Default, Clone)]
    pub struct FieldErrors {
        entries: Vec<(String, Vec<String>)>,
    }

    impl FieldErrors {
        pub fn add(&mut self, field: &str, msg: impl Into<String>) {
            let msg = msg.into();
            match self.entries.iter_mut().find(|(f, _)| f == field) {
                Some((_, list)) => list.push(msg),
                None => self.entries.push((field.to_string(), vec![msg])),
            }
        }
        pub fn has(&self, field: &str) -> bool {
            self.entries.iter().any(|(f, _)| f == field)
        }
        pub fn is_empty(&self) -> bool {
            self.entries.is_empty()
        }
        /// Number of messages over all fields
        pub fn count(&self) -> usize {
            self.entries.iter().map(|(_, l)| l.len()).sum()
        }
        pub fn first(&self) -> Option<&str> {
            self.entries.first().and_then(|(_, l)| l.first()).map(String::as_str)
        }
        pub fn to_json(&self) -> Value {
            let mut m = Map::new();
            for (f, l) in &self.entries {
                m.insert(f.clone(), Value::from(l.clone()));
            }
            Value::Object(m)
        }
        /// Ok(()) when empty, otherwise the 422 error
        pub fn check(self) -> Result<(), super::AppError> {
            if self.entries.is_empty() {
                Ok(())
            } else {
                Err(super::AppError::Validation(self))
            }
        }
    }
}

pub use indexmap_like::FieldErrors as Errors;
