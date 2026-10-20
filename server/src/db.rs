//! Database pool and helpers for turning rows into JSON.

use crate::config::DbConfig;
use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use rust_decimal::Decimal;
use serde_json::{Map, Value};
use sqlx::{
    mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlRow},
    Column, Executor, MySqlPool, Row, TypeInfo, ValueRef,
};
use std::time::Duration;

pub type Db = MySqlPool;

/// Same session settings the previous release used (strict mode, utf8mb4, the
/// server's own time zone) so stored values read and write identically.
pub fn connect_options(c: &DbConfig) -> MySqlConnectOptions {
    MySqlConnectOptions::new()
        .host(&c.host)
        .port(c.port)
        .username(&c.username)
        .password(&c.password)
        .database(&c.database)
        .charset("utf8mb4")
        .collation("utf8mb4_unicode_ci")
        .timezone(None)
        .pipes_as_concat(false)
        .no_engine_substitution(true)
}

pub async fn connect(c: &DbConfig, wait_secs: u64) -> anyhow::Result<Db> {
    let opts = connect_options(c);
    let deadline = std::time::Instant::now() + Duration::from_secs(wait_secs);
    loop {
        let attempt = MySqlPoolOptions::new()
            .max_connections(20)
            .min_connections(1)
            .acquire_timeout(Duration::from_secs(10))
            .idle_timeout(Duration::from_secs(300))
            .after_connect(|conn, _| {
                Box::pin(async move {
                    conn.execute(
                        "SET SESSION sql_mode='ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'",
                    )
                    .await?;
                    Ok(())
                })
            })
            .connect_with(opts.clone())
            .await;
        match attempt {
            Ok(pool) => {
                sqlx::query("SELECT 1").execute(&pool).await?;
                return Ok(pool);
            }
            Err(e) if std::time::Instant::now() < deadline => {
                tracing::warn!(error = %e, "waiting for the database");
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
            Err(e) => return Err(anyhow::anyhow!("database is not reachable: {e}")),
        }
    }
}

/// Column value as JSON, with the same types the previous API returned:
/// integers as numbers, DECIMAL as strings ("12.50"), dates as "Y-m-d H:i:s".
pub fn column_json(row: &MySqlRow, idx: usize) -> Value {
    let raw = match row.try_get_raw(idx) {
        Ok(r) => r,
        Err(_) => return Value::Null,
    };
    if raw.is_null() {
        return Value::Null;
    }
    let ty = raw.type_info().name().to_ascii_uppercase();
    let unsigned = ty.contains("UNSIGNED");
    match ty.trim_end_matches(" UNSIGNED") {
        "BOOLEAN" | "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "INTEGER" | "BIGINT" => {
            if unsigned {
                row.try_get::<u64, _>(idx).map(Value::from).unwrap_or(Value::Null)
            } else {
                row.try_get::<i64, _>(idx).map(Value::from).unwrap_or(Value::Null)
            }
        }
        "DECIMAL" | "NUMERIC" => row.try_get::<Decimal, _>(idx).map(|d| Value::from(d.to_string())).unwrap_or(Value::Null),
        // PHP's json_encode writes whole doubles without ".0"
        "FLOAT" | "DOUBLE" | "REAL" => row.try_get::<f64, _>(idx).map(crate::util::json_num).unwrap_or(Value::Null),
        // sqlx decodes TIMESTAMP only as DateTime<Utc>; its fields are the
        // session's wall-clock value either way
        "DATETIME" | "TIMESTAMP" => row
            .try_get::<NaiveDateTime, _>(idx)
            .or_else(|_| row.try_get::<chrono::DateTime<chrono::Utc>, _>(idx).map(|d| d.naive_utc()))
            .map(|d| Value::from(d.format("%Y-%m-%d %H:%M:%S").to_string()))
            .unwrap_or(Value::Null),
        "DATE" => row.try_get::<NaiveDate, _>(idx).map(|d| Value::from(d.format("%Y-%m-%d").to_string())).unwrap_or(Value::Null),
        "TIME" => row.try_get::<NaiveTime, _>(idx).map(|d| Value::from(d.format("%H:%M:%S").to_string())).unwrap_or(Value::Null),
        "YEAR" => row.try_get::<u16, _>(idx).map(Value::from).unwrap_or(Value::Null),
        "JSON" => row.try_get::<serde_json::Value, _>(idx).unwrap_or(Value::Null),
        "BIT" => row.try_get::<u64, _>(idx).map(Value::from).unwrap_or(Value::Null),
        _ => match row.try_get::<String, _>(idx) {
            Ok(s) => Value::from(s),
            Err(_) => row.try_get::<Vec<u8>, _>(idx).map(|b| Value::from(String::from_utf8_lossy(&b).into_owned())).unwrap_or(Value::Null),
        },
    }
}

/// Whole row as a JSON object keyed by column name.
pub fn row_json(row: &MySqlRow) -> Map<String, Value> {
    let mut m = Map::with_capacity(row.columns().len());
    for (i, col) in row.columns().iter().enumerate() {
        m.insert(col.name().to_string(), column_json(row, i));
    }
    m
}

pub fn rows_json(rows: &[MySqlRow]) -> Vec<Map<String, Value>> {
    rows.iter().map(row_json).collect()
}

/// Quote an identifier that came from a whitelist (never from raw input).
pub fn ident(name: &str) -> String {
    debug_assert!(name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.'));
    name.split('.').map(|p| format!("`{p}`")).collect::<Vec<_>>().join(".")
}

/// LIKE pattern with %, _ and \ escaped. `prefix_only` = "starts with" search.
pub fn like_pattern(term: &str, prefix_only: bool) -> String {
    let escaped = term.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    if prefix_only {
        format!("{escaped}%")
    } else {
        format!("%{escaped}%")
    }
}

/// Small helpers for reading typed values out of a JSON row map.
pub trait RowExt {
    fn i64(&self, key: &str) -> i64;
    fn opt_i64(&self, key: &str) -> Option<i64>;
    fn str(&self, key: &str) -> String;
    fn opt_str(&self, key: &str) -> Option<String>;
    fn bool(&self, key: &str) -> bool;
    fn f64(&self, key: &str) -> f64;
    fn val(&self, key: &str) -> Value;
}

impl RowExt for Map<String, Value> {
    fn i64(&self, key: &str) -> i64 {
        self.opt_i64(key).unwrap_or(0)
    }
    fn opt_i64(&self, key: &str) -> Option<i64> {
        match self.get(key) {
            Some(Value::Number(n)) => n.as_i64().or_else(|| n.as_u64().map(|v| v as i64)).or_else(|| n.as_f64().map(|f| f as i64)),
            Some(Value::String(s)) => s.trim().parse::<f64>().ok().map(|f| f as i64),
            Some(Value::Bool(b)) => Some(*b as i64),
            _ => None,
        }
    }
    fn str(&self, key: &str) -> String {
        self.opt_str(key).unwrap_or_default()
    }
    fn opt_str(&self, key: &str) -> Option<String> {
        match self.get(key) {
            Some(Value::String(s)) => Some(s.clone()),
            Some(Value::Null) | None => None,
            Some(v) => Some(v.to_string()),
        }
    }
    fn bool(&self, key: &str) -> bool {
        crate::util::truthy(self.get(key).unwrap_or(&Value::Null))
    }
    fn f64(&self, key: &str) -> f64 {
        crate::util::num(self.get(key).unwrap_or(&Value::Null))
    }
    fn val(&self, key: &str) -> Value {
        self.get(key).cloned().unwrap_or(Value::Null)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn like_escapes_wildcards() {
        assert_eq!(like_pattern("50%_off", false), "%50\\%\\_off%");
        assert_eq!(like_pattern("tea", true), "tea%");
    }
}
