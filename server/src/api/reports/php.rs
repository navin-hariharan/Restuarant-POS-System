//! Small conversions that reproduce how the previous API turned request
//! values and stored data into JSON.

use chrono::{Datelike, NaiveDateTime, Timelike};
use regex::Regex;
use serde_json::{Map, Value};
use std::sync::LazyLock;

/// Integer value of a request parameter like PHP's `(int)` cast:
/// "12abc" = 12, "1e3" = 1000, "abc" = 0.
pub fn int_cast(v: Option<&Value>) -> i64 {
    static NUM: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?").expect("regex"));
    match v {
        Some(Value::Number(n)) => n.as_i64().unwrap_or_else(|| n.as_f64().map(clamp_f64).unwrap_or(0)),
        Some(Value::Bool(b)) => *b as i64,
        Some(Value::String(s)) => {
            let t = s.trim_start_matches([' ', '\t', '\n', '\r', '\x0b', '\x0c']);
            NUM.find(t).and_then(|m| m.as_str().parse::<f64>().ok()).map(clamp_f64).unwrap_or(0)
        }
        Some(Value::Array(a)) => !a.is_empty() as i64,
        Some(Value::Object(o)) => !o.is_empty() as i64,
        _ => 0,
    }
}

fn clamp_f64(f: f64) -> i64 {
    if f.is_finite() {
        f.trunc().clamp(i64::MIN as f64, i64::MAX as f64) as i64
    } else {
        0
    }
}

/// Current page for paginated lists: a valid integer of at least 1, else 1.
pub fn page_number(v: Option<&Value>) -> i64 {
    static INT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[+-]?(0|[1-9]\d*)$").expect("regex"));
    let n = match v {
        Some(Value::Number(n)) => n.as_i64(),
        Some(Value::String(s)) => Some(s.trim()).filter(|s| INT.is_match(s)).and_then(|s| s.parse::<i64>().ok()),
        _ => None,
    };
    n.filter(|n| *n >= 1).unwrap_or(1)
}

/// A request value used as a single SQL value: arrays give their first
/// element, objects their first value.
pub fn scalar(v: &Value) -> Option<Value> {
    match v {
        Value::Null => None,
        Value::Array(a) => a.iter().find_map(scalar),
        Value::Object(o) => o.values().find_map(scalar),
        other => Some(other.clone()),
    }
}

/// Text of a scalar request value.
pub fn text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(true) => "1".into(),
        Value::Bool(false) | Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// A grouping key as it appears once used as an array key: canonical
/// integers become numbers, null becomes "".
pub fn array_key(v: Option<&str>) -> Value {
    static CANON: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(0|-?[1-9]\d*)$").expect("regex"));
    match v {
        None => Value::from(""),
        Some(s) if CANON.is_match(s) => s.parse::<i64>().map(Value::from).unwrap_or_else(|_| Value::from(s)),
        Some(s) => Value::from(s),
    }
}

/// Stored JSON text decoded the way the previous API re-encoded it: empty
/// objects and objects keyed 0..n become arrays, whole floats print as integers.
pub fn json_text(text: Option<&str>) -> Value {
    text.and_then(|t| serde_json::from_str::<Value>(t).ok()).map(normalize_json).unwrap_or(Value::Null)
}

fn normalize_json(v: Value) -> Value {
    match v {
        Value::Object(o) => {
            let is_list = o.keys().enumerate().all(|(i, k)| *k == i.to_string());
            if is_list {
                Value::Array(o.into_iter().map(|(_, x)| normalize_json(x)).collect())
            } else {
                Value::Object(o.into_iter().map(|(k, x)| (k, normalize_json(x))).collect::<Map<_, _>>())
            }
        }
        Value::Array(a) => Value::Array(a.into_iter().map(normalize_json).collect()),
        Value::Number(n) if n.is_f64() => n.as_f64().map(crate::util::json_num).unwrap_or(Value::Number(n)),
        other => other,
    }
}

/// "3 hours ago" / "2 days from now", the largest calendar unit only.
pub fn diff_for_humans(then: NaiveDateTime, now: NaiveDateTime) -> String {
    let (a, b, future) = if then > now { (now, then, true) } else { (then, now, false) };
    // whole calendar months between a and b
    let mut months = ((b.year() - a.year()) * 12 + b.month() as i32 - a.month() as i32) as i64;
    let a_rest = (a.day(), a.hour(), a.minute(), a.second());
    let b_rest = (b.day(), b.hour(), b.minute(), b.second());
    if b_rest < a_rest {
        months -= 1;
    }
    let (count, unit) = if months >= 12 {
        (months / 12, "year")
    } else if months >= 1 {
        (months, "month")
    } else {
        let secs = (b - a).num_seconds();
        let days = secs / 86_400;
        if days >= 7 {
            (days / 7, "week")
        } else if days >= 1 {
            (days, "day")
        } else if secs >= 3600 {
            (secs / 3600, "hour")
        } else if secs >= 60 {
            (secs / 60, "minute")
        } else {
            (secs.max(1), "second")
        }
    };
    let plural = if count == 1 { "" } else { "s" };
    format!("{count} {unit}{plural} {}", if future { "from now" } else { "ago" })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").unwrap()
    }

    #[test]
    fn int_casts() {
        assert_eq!(int_cast(Some(&json!("12abc"))), 12);
        assert_eq!(int_cast(Some(&json!("1e3"))), 1000);
        assert_eq!(int_cast(Some(&json!("abc"))), 0);
        assert_eq!(int_cast(Some(&json!(" 7"))), 7);
        assert_eq!(int_cast(Some(&json!(2.9))), 2);
        assert_eq!(int_cast(None), 0);
        assert_eq!(page_number(Some(&json!("3"))), 3);
        assert_eq!(page_number(Some(&json!("03"))), 1);
        assert_eq!(page_number(Some(&json!("-2"))), 1);
    }

    #[test]
    fn keys_and_json() {
        assert_eq!(array_key(Some("5")), json!(5));
        assert_eq!(array_key(Some("05")), json!("05"));
        assert_eq!(array_key(None), json!(""));
        assert_eq!(json_text(Some("{}")), json!([]));
        assert_eq!(json_text(Some(r#"{"0":"a","1":{"x":1.0}}"#)), json!(["a", {"x": 1}]));
        assert_eq!(json_text(Some("not json")), Value::Null);
    }

    #[test]
    fn human_diffs() {
        let now = dt("2026-10-18 21:00:00");
        let ago = |s| diff_for_humans(dt(s), now);
        assert_eq!(ago("2026-10-18 21:00:00"), "1 second ago");
        assert_eq!(ago("2026-10-18 20:59:01"), "59 seconds ago");
        assert_eq!(ago("2026-10-18 20:00:00"), "1 hour ago");
        assert_eq!(ago("2026-10-17 21:00:01"), "23 hours ago");
        assert_eq!(ago("2026-10-11 21:00:00"), "1 week ago");
        assert_eq!(ago("2026-09-18 21:00:01"), "4 weeks ago");
        assert_eq!(ago("2026-09-18 21:00:00"), "1 month ago");
        assert_eq!(ago("2025-10-18 21:00:01"), "11 months ago");
        assert_eq!(ago("2024-08-01 00:00:00"), "2 years ago");
        assert_eq!(diff_for_humans(dt("2026-10-21 21:00:00"), now), "3 days from now");
    }
}
