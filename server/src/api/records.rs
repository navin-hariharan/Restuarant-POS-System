//! Helpers shared by the admin record screens owned by this module group
//! (taxes, payment methods, pickup points, service tables, expenses,
//! customers and room reservations): loading a record by its route key,
//! the few validation rules these forms use, PHP-compatible value
//! formatting and dirty-aware inserts / updates.

use crate::{
    db::RowExt,
    error::{AppError, AppResult},
    query::{bind_all, Arg, Sql},
    settings::Settings,
    state::AppState,
};
use chrono::NaiveDateTime;
use serde_json::{Map, Value};

pub type Row = Map<String, Value>;

/// Numeric route id; anything else cannot match a record.
pub fn path_id(raw: &str) -> AppResult<i64> {
    raw.trim().parse::<i64>().ok().filter(|v| *v > 0).ok_or_else(AppError::not_found)
}

/// `SELECT * FROM <table> WHERE <col> = ?` (table and column from code only), 404 when missing.
pub async fn find_by(state: &AppState, table: &'static str, col: &'static str, value: impl Into<Arg>) -> AppResult<Row> {
    let mut q = Sql::new(format!("SELECT * FROM `{table}` WHERE `{col}` = ? LIMIT 1"));
    q.args.push(value.into());
    q.fetch_optional(&state.db).await?.ok_or_else(AppError::not_found)
}

pub async fn find(state: &AppState, table: &'static str, raw_id: &str) -> AppResult<Row> {
    let id = path_id(raw_id)?;
    find_by(state, table, "id", id).await
}

/// Number of rows of `table` where `col = value` (table and column from code only).
pub async fn count_where(state: &AppState, table: &'static str, col: &'static str, value: impl Into<Arg>) -> AppResult<i64> {
    let mut q = Sql::new(format!("SELECT COUNT(*) AS c FROM `{table}` WHERE `{col}` = ?"));
    q.args.push(value.into());
    Ok(q.scalar_f64(&state.db).await? as i64)
}

/// the `unique:<table>,<col>[,<ignore id>]` rule.
pub async fn taken(state: &AppState, table: &'static str, col: &'static str, value: &Value, ignore_id: Option<i64>) -> AppResult<bool> {
    let mut q = Sql::new(format!("SELECT COUNT(*) AS c FROM `{table}` WHERE `{col}` = ?"));
    q.args.push(Arg::from(value));
    if let Some(id) = ignore_id {
        q.and("`id` <> ?", id);
    }
    Ok(q.scalar_f64(&state.db).await? > 0.0)
}

// ---------------------------------------------------------------- rules

/// the `required`: present, not null, not a blank string, not an empty list.
pub fn filled(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::String(s)) => !s.trim().is_empty(),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Object(o)) => !o.is_empty(),
        Some(_) => true,
    }
}

/// the `boolean`: true, false, 0, 1, "0" or "1".
pub fn is_bool_like(v: &Value) -> bool {
    match v {
        Value::Bool(_) => true,
        Value::Number(n) => matches!(n.as_i64(), Some(0 | 1)) && !n.is_f64(),
        Value::String(s) => s == "0" || s == "1",
        _ => false,
    }
}

/// PHP `is_numeric`.
pub fn is_numeric(v: &Value) -> bool {
    match v {
        Value::Number(_) => true,
        Value::String(s) => numeric_str(s),
        _ => false,
    }
}

fn numeric_str(s: &str) -> bool {
    let s = s.trim_start_matches([' ', '\t', '\n', '\r', '\x0b', '\x0c']).trim_end_matches([' ', '\t', '\n', '\r', '\x0b', '\x0c']);
    let b = s.as_bytes();
    let mut i = 0;
    if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
        i += 1;
    }
    let int_start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    let int_digits = i - int_start;
    let mut frac_digits = 0;
    if i < b.len() && b[i] == b'.' {
        i += 1;
        let f = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        frac_digits = i - f;
    }
    if int_digits + frac_digits == 0 {
        return false;
    }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        i += 1;
        if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
            i += 1;
        }
        let e = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == e {
            return false;
        }
    }
    i == b.len()
}

/// Character count the `max` rule uses for a non-numeric field.
pub fn char_len(v: &Value) -> usize {
    match v {
        Value::Array(a) => a.len(),
        Value::Object(o) => o.len(),
        other => php_str(other).map(|s| s.chars().count()).unwrap_or(0),
    }
}

/// the `email` (RFC style): local@domain, no spaces, sane dots.
pub fn is_email(s: &str) -> bool {
    let Some((local, domain)) = s.rsplit_once('@') else { return false };
    if local.is_empty() || domain.is_empty() || local.chars().count() > 64 || s.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    let atext = |c: char| c.is_alphanumeric() || "!#$%&'*+-/=?^_`{|}~".contains(c) || !c.is_ascii();
    let local_ok = if local.len() >= 2 && local.starts_with('"') && local.ends_with('"') {
        true
    } else {
        local.split('.').all(|part| !part.is_empty() && part.chars().all(atext))
    };
    if !local_ok {
        return false;
    }
    if domain.starts_with('[') && domain.ends_with(']') {
        return domain.len() > 2;
    }
    domain.split('.').all(|label| {
        !label.is_empty()
            && label.chars().count() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label.chars().all(|c| c.is_alphanumeric() || c == '-')
    })
}

// ---------------------------------------------------------------- PHP values

/// A scalar as PHP turns it into a string ((string)$v); None for null, arrays and objects.
pub fn php_str(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Bool(b) => Some(if *b { "1".into() } else { String::new() }),
        Value::Number(n) => Some(match (n.as_i64(), n.as_u64(), n.as_f64()) {
            (Some(i), _, _) => i.to_string(),
            (_, Some(u), _) => u.to_string(),
            (_, _, Some(f)) if f.fract() == 0.0 && f.abs() < 1e15 => format!("{}", f as i64),
            (_, _, Some(f)) => format!("{f}"),
            _ => n.to_string(),
        }),
        _ => None,
    }
}

/// PHP truthiness ((bool)$v).
pub fn php_truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        Value::String(s) => !(s.is_empty() || s == "0"),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

/// JSON number column (DOUBLE) the way PHP prints it: 12 for 12.0, 12.5 otherwise.
pub fn num(row: &Row, key: &str) -> Value {
    match row.get(key) {
        Some(Value::Number(n)) => n.as_f64().map(crate::util::json_num).unwrap_or(Value::Null),
        Some(Value::String(s)) => s.trim().parse::<f64>().map(crate::util::json_num).unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

/// Stored timestamp in the configured display format (null stays null).
pub fn date(s: &Settings, row: &Row, key: &str) -> Value {
    s.fmt_value(&row.val(key))
}

/// Request arrays the way PHP sees them: objects keyed "0".."n-1" are lists.
pub fn php_normalize(v: &Value) -> Value {
    match v {
        Value::Object(o) => {
            let is_list = !o.is_empty() && o.keys().enumerate().all(|(i, k)| *k == i.to_string());
            if is_list {
                Value::Array(o.values().map(php_normalize).collect())
            } else {
                Value::Object(o.iter().map(|(k, x)| (k.clone(), php_normalize(x))).collect())
            }
        }
        Value::Array(a) => Value::Array(a.iter().map(php_normalize).collect()),
        other => other.clone(),
    }
}

/// `json_encode` with PHP's default flags (escaped slashes and \uXXXX for
/// non-ASCII), so stored JSON columns are byte-identical to older rows.
pub fn php_json(v: &Value) -> String {
    let mut out = String::new();
    write_json(&php_normalize(v), &mut out);
    out
}

fn write_json(v: &Value, out: &mut String) {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => match (n.as_i64(), n.as_u64(), n.as_f64()) {
            (Some(i), _, _) => out.push_str(&i.to_string()),
            (_, Some(u), _) => out.push_str(&u.to_string()),
            (_, _, Some(f)) => out.push_str(&crate::util::json_num(f).to_string()),
            _ => out.push_str(&n.to_string()),
        },
        Value::String(s) => write_str(s, out),
        Value::Array(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_json(x, out);
            }
            out.push(']');
        }
        Value::Object(o) => {
            if o.is_empty() {
                out.push_str("[]");
                return;
            }
            out.push('{');
            for (i, (k, x)) in o.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_str(k, out);
                out.push(':');
                write_json(x, out);
            }
            out.push('}');
        }
    }
}

fn write_str(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '/' => out.push_str("\\/"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 || (c as u32) > 0x7e => {
                let mut buf = [0u16; 2];
                for unit in c.encode_utf16(&mut buf) {
                    out.push_str(&format!("\\u{unit:04x}"));
                }
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// Decode a JSON text column (null or invalid text gives null).
pub fn json_col(row: &Row, key: &str) -> Value {
    match row.get(key) {
        Some(Value::String(s)) => serde_json::from_str(s).unwrap_or(Value::Null),
        Some(Value::Null) | None => Value::Null,
        Some(other) => other.clone(),
    }
}

// ---------------------------------------------------------------- writes

/// How a column is compared when deciding whether an update changes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cast {
    Plain,
    Bool,
    Json,
}

/// One column to write: the request value plus how it is stored.
pub struct Col {
    pub name: &'static str,
    pub value: Value,
    pub cast: Cast,
}

impl Col {
    pub fn plain(name: &'static str, value: Value) -> Self {
        Self { name, value, cast: Cast::Plain }
    }
    pub fn boolean(name: &'static str, value: Value) -> Self {
        Self { name, value, cast: Cast::Bool }
    }
    pub fn json(name: &'static str, value: Value) -> Self {
        Self { name, value, cast: Cast::Json }
    }

    /// The bound value: JSON columns hold PHP-encoded text, booleans 0/1.
    pub fn arg(&self) -> Arg {
        match (self.cast, &self.value) {
            (_, Value::Null) => Arg::Null,
            (Cast::Json, v) => Arg::Str(php_json(v)),
            (_, Value::Bool(b)) => Arg::Int(*b as i64),
            (_, v @ (Value::Array(_) | Value::Object(_))) => Arg::Str(php_json(v)),
            (_, v) => Arg::from(v),
        }
    }

    /// Whether writing this value changes the stored one (Eloquent's dirty check).
    pub fn changes(&self, row: &Row) -> bool {
        let orig = row.val(self.name);
        match self.cast {
            Cast::Json => {
                let before = match &orig {
                    Value::String(s) => serde_json::from_str::<Value>(s).ok().map(|v| php_json(&v)),
                    _ => None,
                };
                let after = (!self.value.is_null()).then(|| php_json(&self.value));
                before != after
            }
            Cast::Bool => {
                if orig.is_null() || self.value.is_null() {
                    return orig.is_null() != self.value.is_null();
                }
                php_truthy(&orig) != php_truthy(&self.value)
            }
            Cast::Plain => {
                if orig.is_null() || self.value.is_null() {
                    return orig.is_null() != self.value.is_null();
                }
                match (php_str(&orig), php_str(&self.value)) {
                    (Some(a), Some(b)) => a != b,
                    _ => php_json(&orig) != php_json(&self.value),
                }
            }
        }
    }
}

/// INSERT the given columns plus timestamps; returns the new id.
pub async fn insert<'c, E>(db: E, table: &'static str, cols: &[Col], now: NaiveDateTime) -> AppResult<i64>
where
    E: sqlx::Executor<'c, Database = sqlx::MySql>,
{
    let mut names: Vec<String> = cols.iter().map(|c| format!("`{}`", c.name)).collect();
    names.push("`updated_at`".into());
    names.push("`created_at`".into());
    let marks = vec!["?"; names.len()].join(", ");
    let sql = format!("INSERT INTO `{table}` ({}) VALUES ({marks})", names.join(", "));
    let mut args: Vec<Arg> = cols.iter().map(Col::arg).collect();
    args.push(Arg::Time(now));
    args.push(Arg::Time(now));
    let res = bind_all(sqlx::query(&sql), &args).execute(db).await?;
    Ok(res.last_insert_id() as i64)
}

/// UPDATE only the columns whose value changes (and then `updated_at`), like
/// Eloquent's `update()`. Returns whether anything was written.
pub async fn update<'c, E>(db: E, table: &'static str, row: &Row, cols: &[Col], now: NaiveDateTime) -> AppResult<bool>
where
    E: sqlx::Executor<'c, Database = sqlx::MySql>,
{
    let dirty: Vec<&Col> = cols.iter().filter(|c| c.changes(row)).collect();
    if dirty.is_empty() {
        return Ok(false);
    }
    let sets: Vec<String> = dirty.iter().map(|c| format!("`{}` = ?", c.name)).collect();
    let sql = format!("UPDATE `{table}` SET {}, `updated_at` = ? WHERE `id` = ?", sets.join(", "));
    let mut args: Vec<Arg> = dirty.iter().map(|c| c.arg()).collect();
    args.push(Arg::Time(now));
    args.push(Arg::Int(row.i64("id")));
    bind_all(sqlx::query(&sql), &args).execute(db).await?;
    Ok(true)
}

/// Ids from a `rows` / `ids` request list (numbers or numeric strings).
pub fn id_list(v: Option<&Value>) -> Vec<i64> {
    let items: Vec<Value> = match v {
        Some(Value::Array(a)) => a.clone(),
        Some(Value::Object(o)) => o.values().cloned().collect(),
        Some(other @ (Value::Number(_) | Value::String(_))) => vec![other.clone()],
        _ => vec![],
    };
    items
        .iter()
        .filter_map(|x| match x {
            Value::Number(n) => n.as_i64(),
            Value::String(s) => s.trim().parse::<i64>().ok(),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn php_json_matches_json_encode() {
        assert_eq!(php_json(&json!({"a": "x/y", "b": "é", "c": 10.0, "d": 0.5, "e": {}})), "{\"a\":\"x\\/y\",\"b\":\"\\u00e9\",\"c\":10,\"d\":0.5,\"e\":[]}");
        assert_eq!(php_json(&json!({"0": "a", "1": "b"})), r#"["a","b"]"#);
        assert_eq!(php_json(&json!("😀")), "\"\\ud83d\\ude00\"");
    }

    #[test]
    fn numeric_like_php() {
        for ok in ["1", " 1", "1 ", "-1.5", ".5", "5.", "1e3", "+2"] {
            assert!(numeric_str(ok), "{ok}");
        }
        for bad in ["", ".", "abc", "1a", "0x1A", "1e", "--1"] {
            assert!(!numeric_str(bad), "{bad}");
        }
    }

    #[test]
    fn email_rule() {
        assert!(is_email("a@b.com"));
        assert!(is_email("first.last+tag@sub.example.org"));
        assert!(is_email("a@localhost"));
        assert!(!is_email("plain"));
        assert!(!is_email("a b@c.com"));
        assert!(!is_email("a@b..com"));
        assert!(!is_email(".a@b.com"));
        assert!(!is_email("a@"));
    }

    #[test]
    fn dirty_check() {
        let row: Row = json!({"id": 1, "title": "Cash", "rate": 5.0, "price": "10.00", "flag": 1, "note": null}).as_object().unwrap().clone();
        assert!(!Col::plain("title", json!("Cash")).changes(&row));
        assert!(Col::plain("title", json!("Card")).changes(&row));
        assert!(!Col::plain("rate", json!(5)).changes(&row));
        assert!(!Col::plain("rate", json!("5")).changes(&row));
        assert!(Col::plain("price", json!("10")).changes(&row));
        assert!(!Col::boolean("flag", json!(true)).changes(&row));
        assert!(Col::boolean("flag", json!(false)).changes(&row));
        assert!(!Col::plain("note", Value::Null).changes(&row));
        assert!(Col::plain("note", json!("x")).changes(&row));
    }

    #[test]
    fn php_strings() {
        assert_eq!(php_str(&json!(12.0)).unwrap(), "12");
        assert_eq!(php_str(&json!(12.5)).unwrap(), "12.5");
        assert_eq!(php_str(&json!(false)).unwrap(), "");
        assert_eq!(id_list(Some(&json!([1, "2", "x"]))), vec![1, 2]);
    }
}
