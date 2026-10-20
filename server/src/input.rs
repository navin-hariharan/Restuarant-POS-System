//! Request input: query string + body (JSON, urlencoded form or multipart)
//! merged into one JSON object, with uploaded files kept aside.
//!
//! Like the previous API, strings are trimmed (except passwords) and empty
//! strings become null, and `a[b]=1` / `a[]=1` keys become nested values.

use crate::error::AppError;
use crate::state::AppState;
use axum::{
    extract::{FromRequest, Multipart, Request},
    http::header::CONTENT_TYPE,
};
use serde_json::{Map, Value};
use std::path::PathBuf;
use tokio::io::AsyncWriteExt;

/// Largest single uploaded file accepted by the generic extractor.
pub const MAX_FILE_BYTES: usize = 20 * 1024 * 1024;

pub struct Input {
    pub data: Map<String, Value>,
    pub files: Vec<UploadedFile>,
}

/// An uploaded file in the temp folder; removed when dropped unless moved.
#[derive(Debug)]
pub struct UploadedFile {
    pub field: String,
    pub file_name: String,
    pub size: usize,
    pub path: PathBuf,
}

impl Drop for UploadedFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

impl UploadedFile {
    pub async fn bytes(&self) -> std::io::Result<Vec<u8>> {
        tokio::fs::read(&self.path).await
    }
}

const NO_TRIM: [&str; 4] = ["password", "password_confirmation", "current_password", "new_password"];

fn normalize(key: &str, v: Value) -> Value {
    match v {
        Value::String(s) => {
            let s = if NO_TRIM.contains(&key) { s } else { s.trim().to_string() };
            if s.is_empty() {
                Value::Null
            } else {
                Value::String(s)
            }
        }
        Value::Array(a) => Value::Array(a.into_iter().map(|x| normalize("", x)).collect()),
        Value::Object(o) => Value::Object(
            o.into_iter()
                .map(|(k, x)| {
                    let n = normalize(&k, x);
                    (k, n)
                })
                .collect(),
        ),
        other => other,
    }
}

/// Insert `name` (possibly "a[b][]") = value into `map`.
pub fn insert_bracketed(map: &mut Map<String, Value>, name: &str, value: Value) {
    let (head, rest) = match name.find('[') {
        Some(i) if name.ends_with(']') => (&name[..i], &name[i..]),
        _ => {
            map.insert(name.to_string(), value);
            return;
        }
    };
    let mut keys: Vec<&str> = vec![head];
    let mut r = rest;
    while let Some(stripped) = r.strip_prefix('[') {
        match stripped.find(']') {
            Some(end) => {
                keys.push(&stripped[..end]);
                r = &stripped[end + 1..];
            }
            None => break,
        }
    }
    fn put(slot: &mut Value, keys: &[&str], value: Value) {
        if keys.is_empty() {
            *slot = value;
            return;
        }
        let k = keys[0];
        if k.is_empty() {
            if !slot.is_array() {
                *slot = Value::Array(vec![]);
            }
            let arr = slot.as_array_mut().unwrap();
            arr.push(Value::Null);
            let last = arr.last_mut().unwrap();
            put(last, &keys[1..], value);
        } else {
            if !slot.is_object() {
                // numeric keys on an array: convert to object keyed by index
                let mut m = Map::new();
                if let Value::Array(a) = std::mem::take(slot) {
                    for (i, v) in a.into_iter().enumerate() {
                        m.insert(i.to_string(), v);
                    }
                }
                *slot = Value::Object(m);
            }
            let obj = slot.as_object_mut().unwrap();
            let entry = obj.entry(k.to_string()).or_insert(Value::Null);
            put(entry, &keys[1..], value);
        }
    }
    let entry = map.entry(keys[0].to_string()).or_insert(Value::Null);
    put(entry, &keys[1..], value);
}

pub fn parse_urlencoded(s: &str) -> Map<String, Value> {
    let mut m = Map::new();
    for pair in s.split('&').filter(|p| !p.is_empty()) {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let k = decode(k);
        let v = decode(v);
        insert_bracketed(&mut m, &k, Value::String(v));
    }
    m
}

fn decode(s: &str) -> String {
    let s = s.replace('+', " ");
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

impl FromRequest<AppState> for Input {
    type Rejection = AppError;

    async fn from_request(req: Request, state: &AppState) -> Result<Self, Self::Rejection> {
        let mut data = req.uri().query().map(parse_urlencoded).unwrap_or_default();
        let mut files = Vec::new();
        let ct = req.headers().get(CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_ascii_lowercase();

        if ct.starts_with("application/json") {
            let bytes = axum::body::to_bytes(req.into_body(), MAX_FILE_BYTES)
                .await
                .map_err(|_| AppError::bad_request("Request body is too large."))?;
            if !bytes.is_empty() {
                let v: Value = serde_json::from_slice(&bytes).map_err(|_| AppError::bad_request("Invalid JSON body."))?;
                if let Value::Object(o) = v {
                    data.extend(o);
                }
            }
        } else if ct.starts_with("application/x-www-form-urlencoded") {
            let bytes = axum::body::to_bytes(req.into_body(), MAX_FILE_BYTES)
                .await
                .map_err(|_| AppError::bad_request("Request body is too large."))?;
            data.extend(parse_urlencoded(&String::from_utf8_lossy(&bytes)));
        } else if ct.starts_with("multipart/form-data") {
            let mut mp = Multipart::from_request(req, state).await.map_err(|_| AppError::bad_request("Invalid form data."))?;
            let tmp = state.cfg.tmp_dir();
            tokio::fs::create_dir_all(&tmp).await.map_err(anyhow::Error::from)?;
            while let Some(mut field) = mp.next_field().await.map_err(|_| AppError::bad_request("Invalid form data."))? {
                let name = field.name().unwrap_or_default().to_string();
                if let Some(file_name) = field.file_name().map(str::to_string) {
                    let path = tmp.join(format!("upload-{}", crate::util::uuid()));
                    let mut f = tokio::fs::File::create(&path).await.map_err(anyhow::Error::from)?;
                    let mut size = 0usize;
                    let mut upload = UploadedFile { field: name.clone(), file_name, size: 0, path };
                    while let Some(chunk) = field.chunk().await.map_err(|_| AppError::bad_request("Upload was interrupted."))? {
                        size += chunk.len();
                        if size > MAX_FILE_BYTES {
                            return Err(AppError::field(&name, "The file is too large."));
                        }
                        f.write_all(&chunk).await.map_err(anyhow::Error::from)?;
                    }
                    f.flush().await.map_err(anyhow::Error::from)?;
                    if size == 0 && upload.file_name.is_empty() {
                        continue; // empty file input
                    }
                    upload.size = size;
                    files.push(upload);
                } else {
                    let text = field.text().await.map_err(|_| AppError::bad_request("Invalid form data."))?;
                    insert_bracketed(&mut data, &name, Value::String(text));
                }
            }
        }

        let data = data
            .into_iter()
            .map(|(k, v)| {
                let n = normalize(&k, v);
                (k, n)
            })
            .collect();
        Ok(Input { data, files })
    }
}

impl Input {
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.data.get(key).filter(|v| !v.is_null())
    }
    pub fn has(&self, key: &str) -> bool {
        self.get(key).is_some()
    }
    /// Key present in the request at all (even if null).
    pub fn present(&self, key: &str) -> bool {
        self.data.contains_key(key)
    }
    pub fn val(&self, key: &str) -> Value {
        self.data.get(key).cloned().unwrap_or(Value::Null)
    }
    /// String value; numbers and bools are converted.
    pub fn str(&self, key: &str) -> Option<String> {
        match self.get(key)? {
            Value::String(s) => Some(s.clone()),
            Value::Bool(b) => Some(if *b { "1".into() } else { "0".into() }),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        }
    }
    /// Like `str`, but the literal "null"/"undefined" (sent by form data) counts as missing.
    pub fn opt_str(&self, key: &str) -> Option<String> {
        self.str(key).filter(|s| s != "null" && s != "undefined")
    }
    pub fn string(&self, key: &str) -> String {
        self.opt_str(key).unwrap_or_default()
    }
    pub fn bool(&self, key: &str) -> bool {
        self.get(key).map(crate::util::truthy).unwrap_or(false)
    }
    pub fn i64(&self, key: &str) -> Option<i64> {
        match self.get(key)? {
            Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
            Value::String(s) => s.trim().parse::<i64>().ok().or_else(|| s.trim().parse::<f64>().ok().map(|f| f as i64)),
            Value::Bool(b) => Some(*b as i64),
            _ => None,
        }
    }
    pub fn f64(&self, key: &str) -> Option<f64> {
        match self.get(key)? {
            Value::Number(n) => n.as_f64(),
            Value::String(s) => s.trim().parse::<f64>().ok().filter(|f| f.is_finite()),
            _ => None,
        }
    }
    /// A value that may arrive as JSON text (form data) or as a JSON value.
    pub fn json(&self, key: &str) -> Option<Value> {
        match self.get(key)? {
            Value::String(s) => serde_json::from_str(s).ok(),
            other => Some(other.clone()),
        }
    }
    pub fn file(&self, field: &str) -> Option<&UploadedFile> {
        self.files.iter().find(|f| f.field == field)
    }
    pub fn take_file(&mut self, field: &str) -> Option<UploadedFile> {
        let i = self.files.iter().position(|f| f.field == field)?;
        Some(self.files.remove(i))
    }
    /// `page` / `perPage` (or `per_page`) for list endpoints.
    pub fn page(&self, default_per_page: i64) -> crate::query::Page {
        let per = self.i64("perPage").or_else(|| self.i64("per_page")).unwrap_or(default_per_page);
        crate::query::Page::new(self.i64("page").unwrap_or(1), per)
    }
    /// sort[column] / sort[order] limited to `allowed` columns.
    pub fn sort(&self, allowed: &[&str], default_col: &str, default_order: &str) -> (String, &'static str) {
        let sort = self.get("sort").and_then(Value::as_object);
        let col =
            sort.and_then(|s| s.get("column")).and_then(Value::as_str).filter(|c| allowed.contains(c)).unwrap_or(default_col).to_string();
        let order = sort
            .and_then(|s| s.get("order"))
            .and_then(Value::as_str)
            .map(str::to_ascii_lowercase)
            .unwrap_or_else(|| default_order.to_ascii_lowercase());
        (col, if order == "desc" { "DESC" } else { "ASC" })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn brackets() {
        let m = parse_urlencoded("sort%5Bcolumn%5D=name&sort[order]=desc&ids[]=1&ids[]=2&q=a+b&empty=");
        assert_eq!(m["sort"], json!({"column": "name", "order": "desc"}));
        assert_eq!(m["ids"], json!(["1", "2"]));
        assert_eq!(m["q"], json!("a b"));
        assert_eq!(normalize("empty", m["empty"].clone()), Value::Null);
    }

    #[test]
    fn trims_but_not_passwords() {
        assert_eq!(normalize("name", json!("  a ")), json!("a"));
        assert_eq!(normalize("password", json!(" a ")), json!(" a "));
    }
}
