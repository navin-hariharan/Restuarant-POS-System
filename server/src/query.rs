//! A small SQL builder with bound arguments, plus pagination in the
//! `{items, pagination}` shape the web app expects.
//!
//! Only ever append SQL text from code (whitelisted identifiers); user values
//! always go through `arg`.

use crate::{
    db::{rows_json, Db},
    error::AppResult,
};
use serde_json::{json, Map, Value};
use sqlx::{mysql::MySqlArguments, query::Query, MySql};

#[derive(Debug, Clone)]
pub enum Arg {
    Str(String),
    Int(i64),
    Float(f64),
    Bool(bool),
    Null,
    Time(chrono::NaiveDateTime),
    Date(chrono::NaiveDate),
}

impl From<&str> for Arg {
    fn from(s: &str) -> Self {
        Arg::Str(s.to_string())
    }
}
impl From<String> for Arg {
    fn from(s: String) -> Self {
        Arg::Str(s)
    }
}
impl From<&String> for Arg {
    fn from(s: &String) -> Self {
        Arg::Str(s.clone())
    }
}
impl From<i64> for Arg {
    fn from(v: i64) -> Self {
        Arg::Int(v)
    }
}
impl From<i32> for Arg {
    fn from(v: i32) -> Self {
        Arg::Int(v as i64)
    }
}
impl From<u64> for Arg {
    fn from(v: u64) -> Self {
        Arg::Int(v as i64)
    }
}
impl From<f64> for Arg {
    fn from(v: f64) -> Self {
        Arg::Float(v)
    }
}
impl From<bool> for Arg {
    fn from(v: bool) -> Self {
        Arg::Bool(v)
    }
}
impl From<chrono::NaiveDateTime> for Arg {
    fn from(v: chrono::NaiveDateTime) -> Self {
        Arg::Time(v)
    }
}
impl From<chrono::NaiveDate> for Arg {
    fn from(v: chrono::NaiveDate) -> Self {
        Arg::Date(v)
    }
}
impl<T: Into<Arg>> From<Option<T>> for Arg {
    fn from(v: Option<T>) -> Self {
        v.map(Into::into).unwrap_or(Arg::Null)
    }
}
impl From<&Value> for Arg {
    fn from(v: &Value) -> Self {
        match v {
            Value::Null => Arg::Null,
            Value::Bool(b) => Arg::Bool(*b),
            Value::Number(n) => n.as_i64().map(Arg::Int).unwrap_or_else(|| Arg::Float(n.as_f64().unwrap_or(0.0))),
            Value::String(s) => Arg::Str(s.clone()),
            other => Arg::Str(other.to_string()),
        }
    }
}
impl From<Value> for Arg {
    fn from(v: Value) -> Self {
        Arg::from(&v)
    }
}

pub fn bind_all<'q>(mut q: Query<'q, MySql, MySqlArguments>, args: &'q [Arg]) -> Query<'q, MySql, MySqlArguments> {
    for a in args {
        q = match a {
            Arg::Str(s) => q.bind(s.as_str()),
            Arg::Int(i) => q.bind(*i),
            Arg::Float(f) => q.bind(*f),
            Arg::Bool(b) => q.bind(*b),
            Arg::Null => q.bind(Option::<String>::None),
            Arg::Time(t) => q.bind(*t),
            Arg::Date(d) => q.bind(*d),
        };
    }
    q
}

#[derive(Debug, Clone, Default)]
pub struct Sql {
    pub text: String,
    pub args: Vec<Arg>,
}

impl Sql {
    pub fn new(text: impl Into<String>) -> Self {
        Self { text: text.into(), args: vec![] }
    }
    /// Append SQL text (from code only).
    pub fn push(&mut self, text: &str) -> &mut Self {
        self.text.push_str(text);
        self
    }
    /// Append SQL text containing `?` placeholders and their values.
    pub fn push_args<A: Into<Arg>>(&mut self, text: &str, args: impl IntoIterator<Item = A>) -> &mut Self {
        self.text.push_str(text);
        self.args.extend(args.into_iter().map(Into::into));
        self
    }
    /// Append " AND <cond>" with one argument.
    pub fn and(&mut self, cond: &str, arg: impl Into<Arg>) -> &mut Self {
        self.text.push_str(" AND ");
        self.text.push_str(cond);
        self.args.push(arg.into());
        self
    }
    /// Append " AND col IN (?, ?, ...)" (always false when empty).
    pub fn and_in(&mut self, col: &str, values: impl IntoIterator<Item = impl Into<Arg>>) -> &mut Self {
        let vals: Vec<Arg> = values.into_iter().map(Into::into).collect();
        if vals.is_empty() {
            self.text.push_str(" AND 1=0");
        } else {
            self.text.push_str(&format!(" AND {col} IN ({})", vec!["?"; vals.len()].join(",")));
            self.args.extend(vals);
        }
        self
    }

    pub async fn fetch_all(&self, db: &Db) -> AppResult<Vec<Map<String, Value>>> {
        let rows = bind_all(sqlx::query(&self.text), &self.args).fetch_all(db).await?;
        Ok(rows_json(&rows))
    }
    pub async fn fetch_optional(&self, db: &Db) -> AppResult<Option<Map<String, Value>>> {
        let row = bind_all(sqlx::query(&self.text), &self.args).fetch_optional(db).await?;
        Ok(row.as_ref().map(crate::db::row_json))
    }
    /// First column of the first row as f64 (for SUM/COUNT queries).
    pub async fn scalar_f64(&self, db: &Db) -> AppResult<f64> {
        let row = self.fetch_optional(db).await?;
        Ok(row.and_then(|m| m.values().next().cloned()).map(|v| crate::util::num(&v)).unwrap_or(0.0))
    }

    /// Run as a page: `SELECT ... ORDER BY ...` text must not contain LIMIT.
    pub async fn paginate(&self, db: &Db, page: Page) -> AppResult<(Vec<Map<String, Value>>, Pagination)> {
        let count_sql = format!("SELECT COUNT(*) AS c FROM ({}) AS counted", self.text);
        let row = bind_all(sqlx::query(&count_sql), &self.args).fetch_one(db).await?;
        let total: i64 = sqlx::Row::try_get(&row, 0).unwrap_or(0);
        let data_sql = format!("{} LIMIT {} OFFSET {}", self.text, page.per_page, page.offset());
        let rows = bind_all(sqlx::query(&data_sql), &self.args).fetch_all(db).await?;
        Ok((rows_json(&rows), Pagination::new(page, total)))
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Page {
    pub page: i64,
    pub per_page: i64,
}

impl Page {
    pub fn new(page: i64, per_page: i64) -> Self {
        Self { page: page.max(1), per_page: if per_page <= 0 { 10 } else { per_page.min(1000) } }
    }
    pub fn offset(&self) -> i64 {
        (self.page - 1) * self.per_page
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Pagination {
    pub current_page: i64,
    pub per_page: i64,
    pub total: i64,
    pub total_pages: i64,
}

impl Pagination {
    pub fn new(page: Page, total: i64) -> Self {
        let total_pages = ((total + page.per_page - 1) / page.per_page).max(1);
        Self { current_page: page.page, per_page: page.per_page, total, total_pages }
    }
    pub fn json(&self) -> Value {
        json!({
            "currentPage": self.current_page,
            "perPage": self.per_page,
            "total": self.total,
            "totalPages": self.total_pages,
        })
    }
}

/// `{ "items": [...], "pagination": {...} }`
pub fn paged(items: Vec<Value>, p: Pagination) -> Value {
    json!({ "items": items, "pagination": p.json() })
}
