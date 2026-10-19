//! Small conversions shared by every module.

use rand::{distr::Alphanumeric, Rng};
use serde_json::Value;

/// true for true, 1, "1", "true", "on", "yes"
pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        Value::String(s) => matches!(s.trim().to_ascii_lowercase().as_str(), "1" | "true" | "on" | "yes"),
        _ => false,
    }
}

/// Number from a JSON number or numeric string; 0 otherwise.
pub fn num(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(0.0),
        Value::String(s) => s.trim().parse::<f64>().ok().filter(|f| f.is_finite()).unwrap_or(0.0),
        Value::Bool(b) => *b as i64 as f64,
        _ => 0.0,
    }
}

/// Round half away from zero to `dp` decimals (like PHP round()).
pub fn round(v: f64, dp: u32) -> f64 {
    let f = 10f64.powi(dp as i32);
    let r = (v * f).abs() + 1e-9;
    r.round().copysign(v) / f
}


pub fn uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn random_string(len: usize) -> String {
    rand::rng().sample_iter(&Alphanumeric).take(len).map(char::from).collect()
}

/// JSON number that stays an integer when it has no fraction.
pub fn json_num(v: f64) -> Value {
    if v.fract() == 0.0 && v.abs() < 9.0e15 {
        Value::from(v as i64)
    } else {
        serde_json::Number::from_f64(v).map(Value::Number).unwrap_or(Value::Null)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn truthy_values() {
        assert!(truthy(&json!("true")));
        assert!(truthy(&json!(1)));
        assert!(!truthy(&json!("0")));
        assert!(!truthy(&json!(null)));
    }

    #[test]
    fn rounding_like_php() {
        assert_eq!(round(2.675, 2), 2.68);
        assert_eq!(round(-1.005, 2), -1.01);
        assert_eq!(round(1.5, 0), 2.0);
    }
}
