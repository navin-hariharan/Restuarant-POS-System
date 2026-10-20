//! Values stored by the previous release were written by PHP, so the order
//! columns that hold JSON (`sales.items`, `sales.tax`, `sale_items.item_data`,
//! reservation payments) must be encoded the same way to stay byte-identical
//! with existing rows: `\/` for slashes, `\uXXXX` for non-ASCII, integral
//! floats without a fraction, `{}` written as `[]`.
//! Also: PHP truthiness, relative times ("2 hours ago") and MD5 (Gravatar).

use chrono::{Datelike, NaiveDate, NaiveDateTime, Timelike};
use serde_json::{Map, Value};

/// `json_encode($value)` with PHP's default flags.
pub fn json_encode(v: &Value) -> String {
    let mut out = String::new();
    encode(v, &mut out);
    out
}

fn encode(v: &Value, out: &mut String) {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                out.push_str(&i.to_string());
            } else if let Some(u) = n.as_u64() {
                out.push_str(&u.to_string());
            } else {
                out.push_str(&json_float(n.as_f64().unwrap_or(0.0)));
            }
        }
        Value::String(s) => encode_str(s, out),
        Value::Array(a) => encode_list(a.iter(), out),
        Value::Object(m) => {
            if is_list(m) {
                encode_list(m.values(), out);
            } else {
                out.push('{');
                for (i, (k, x)) in m.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    encode_str(k, out);
                    out.push(':');
                    encode(x, out);
                }
                out.push('}');
            }
        }
    }
}

fn encode_list<'a>(items: impl Iterator<Item = &'a Value>, out: &mut String) {
    out.push('[');
    for (i, x) in items.enumerate() {
        if i > 0 {
            out.push(',');
        }
        encode(x, out);
    }
    out.push(']');
}

/// A decoded PHP array whose keys are 0..n-1 in order is a list (an empty
/// object decodes to an empty array too).
fn is_list(m: &Map<String, Value>) -> bool {
    m.keys().enumerate().all(|(i, k)| *k == i.to_string())
}

fn encode_str(s: &str, out: &mut String) {
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
            c if (c as u32) < 0x20 || (c as u32) > 0x7e && (c as u32) != 0x7f => {
                let mut buf = [0u16; 2];
                for unit in c.encode_utf16(&mut buf) {
                    out.push_str(&format!("\\u{:04x}", unit));
                }
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// Mantissa digits and decimal exponent of the shortest round-trip form.
fn shortest_digits(v: f64) -> (String, i32) {
    let e = format!("{:e}", v.abs());
    let (mant, exp) = e.split_once('e').unwrap_or((&e, "0"));
    (mant.replace('.', ""), exp.parse().unwrap_or(0))
}

/// A float the way `json_encode` writes it (serialize_precision = -1).
pub fn json_float(v: f64) -> String {
    if !v.is_finite() {
        return "0".into();
    }
    if v == 0.0 {
        return if v.is_sign_negative() { "-0".into() } else { "0".into() };
    }
    let (digits, exp) = shortest_digits(v);
    let decpt = exp + 1;
    if !(-3..=17).contains(&decpt) {
        let sign = if v < 0.0 { "-" } else { "" };
        let rest = if digits.len() > 1 { &digits[1..] } else { "0" };
        let esign = if exp < 0 { "-" } else { "+" };
        format!("{sign}{}.{rest}e{esign}{}", &digits[..1], exp.abs())
    } else {
        format!("{v}")
    }
}

/// A float converted to a string by PHP (`"$x"`, precision = 14).
pub fn float_string(v: f64) -> String {
    if !v.is_finite() {
        return "0".into();
    }
    if v == 0.0 {
        return if v.is_sign_negative() { "-0".into() } else { "0".into() };
    }
    let e = format!("{:.13e}", v);
    let (mant, exp) = e.split_once('e').unwrap_or((&e, "0"));
    let exp: i32 = exp.parse().unwrap_or(0);
    let neg = mant.starts_with('-');
    let digits: String = mant.trim_start_matches('-').replace('.', "");
    let digits = digits.trim_end_matches('0');
    let digits = if digits.is_empty() { "0" } else { digits };
    let sign = if neg { "-" } else { "" };
    if !(-4..15).contains(&exp) {
        let rest = if digits.len() > 1 { &digits[1..] } else { "0" };
        let esign = if exp < 0 { "-" } else { "+" };
        return format!("{sign}{}.{rest}E{esign}{}", &digits[..1], exp.abs());
    }
    let decpt = exp + 1;
    if decpt <= 0 {
        format!("{sign}0.{}{}", "0".repeat((-decpt) as usize), digits)
    } else if (decpt as usize) >= digits.len() {
        format!("{sign}{}{}", digits, "0".repeat(decpt as usize - digits.len()))
    } else {
        format!("{sign}{}.{}", &digits[..decpt as usize], &digits[decpt as usize..])
    }
}

/// A JSON number or numeric string as text the way PHP would bind it.
pub fn number_string(v: &Value) -> Option<String> {
    match v {
        Value::Number(n) => Some(match n.as_i64() {
            Some(i) => i.to_string(),
            None => float_string(n.as_f64().unwrap_or(0.0)),
        }),
        Value::String(s) => s.trim().parse::<f64>().ok().filter(|f| f.is_finite()).map(|_| s.trim().to_string()),
        _ => None,
    }
}

/// PHP `if ($value)`: false, 0, 0.0, "", "0", null and [] are false.
pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        Value::String(s) => !(s.is_empty() || s == "0"),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

/// PHP `empty($value)`.
pub fn empty(v: Option<&Value>) -> bool {
    v.map(|x| !truthy(x)).unwrap_or(true)
}

/// `filter_var($v, FILTER_VALIDATE_BOOLEAN)`.
pub fn filter_bool(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_i64() == Some(1),
        Value::String(s) => matches!(s.trim().to_ascii_lowercase().as_str(), "1" | "true" | "on" | "yes"),
        _ => false,
    }
}

/// `(float) $value`: numbers, numeric strings (leading part), else 0.
pub fn to_float(v: Option<&Value>) -> f64 {
    match v {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::Bool(b)) => *b as i64 as f64,
        Some(Value::String(s)) => leading_number(s),
        _ => 0.0,
    }
}

fn leading_number(s: &str) -> f64 {
    let s = s.trim_start();
    let mut end = 0;
    let b = s.as_bytes();
    let mut seen_digit = false;
    let mut seen_dot = false;
    let mut seen_exp = false;
    while end < b.len() {
        let c = b[end];
        let ok = match c {
            b'0'..=b'9' => {
                seen_digit = true;
                true
            }
            b'+' | b'-' => end == 0 || matches!(b[end - 1], b'e' | b'E'),
            b'.' if !seen_dot && !seen_exp => {
                seen_dot = true;
                true
            }
            b'e' | b'E' if seen_digit && !seen_exp => {
                seen_exp = true;
                true
            }
            _ => false,
        };
        if !ok {
            break;
        }
        end += 1;
    }
    let mut t = &s[..end];
    while !t.is_empty() && t.parse::<f64>().is_err() {
        t = &t[..t.len() - 1];
    }
    t.parse::<f64>().ok().filter(|f| f.is_finite()).unwrap_or(0.0)
}

/// PHP `trim()` characters.
pub fn trim(s: &str) -> &str {
    s.trim_matches(&[' ', '\t', '\n', '\r', '\0', '\x0B'][..])
}

fn days_in_month(y: i32, m: u32) -> u32 {
    let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
    NaiveDate::from_ymd_opt(ny, nm, 1).and_then(|d| d.pred_opt()).map(|d| d.day()).unwrap_or(30)
}

/// y/m/d/h/i/s between two moments like PHP's DateTime::diff (a <= b).
fn calendar_diff(a: &NaiveDateTime, b: &NaiveDateTime) -> [i64; 6] {
    let mut s = b.second() as i64 - a.second() as i64;
    let mut i = b.minute() as i64 - a.minute() as i64;
    let mut h = b.hour() as i64 - a.hour() as i64;
    let mut d = b.day() as i64 - a.day() as i64;
    let mut m = b.month() as i64 - a.month() as i64;
    let mut y = b.year() as i64 - a.year() as i64;
    if s < 0 {
        s += 60;
        i -= 1;
    }
    if i < 0 {
        i += 60;
        h -= 1;
    }
    if h < 0 {
        h += 24;
        d -= 1;
    }
    if d < 0 {
        let (py, pm) = if b.month() == 1 { (b.year() - 1, 12) } else { (b.year(), b.month() - 1) };
        d += days_in_month(py, pm) as i64;
        m -= 1;
    }
    if m < 0 {
        m += 12;
        y -= 1;
    }
    [y, m, d, h, i, s]
}

/// English relative time like Carbon's `diffForHumans()` ("3 hours ago").
pub fn diff_for_humans(dt: &NaiveDateTime, now: &NaiveDateTime) -> String {
    let past = dt <= now;
    let (a, b) = if past { (dt, now) } else { (now, dt) };
    let [y, m, d, h, i, s] = calendar_diff(a, b);
    let units = [(y, "year"), (m, "month"), (d / 7, "week"), (d % 7, "day"), (h, "hour"), (i, "minute"), (s, "second")];
    let (count, unit) = units.iter().copied().find(|(c, _)| *c > 0).unwrap_or((1, "second"));
    let plural = if count == 1 { "" } else { "s" };
    format!("{count} {unit}{plural} {}", if past { "ago" } else { "from now" })
}

/// Shift by whole months with PHP's overflow rules (Mar 31 - 1 month = Mar 3).
pub fn add_months(dt: &NaiveDateTime, months: i32) -> NaiveDateTime {
    let total = dt.year() * 12 + dt.month0() as i32 + months;
    let (y, m0) = (total.div_euclid(12), total.rem_euclid(12) as u32);
    let first = NaiveDate::from_ymd_opt(y, m0 + 1, 1).unwrap_or(dt.date());
    let date = first + chrono::Duration::days(dt.day() as i64 - 1);
    date.and_time(dt.time())
}

/// MD5 hex digest (Gravatar URLs).
pub fn md5_hex(input: &[u8]) -> String {
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    let k: Vec<u32> = (0..64).map(|i| ((i as f64 + 1.0).sin().abs() * 4294967296.0) as u32).collect();
    let mut msg = input.to_vec();
    let bit_len = (input.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_le_bytes());
    let (mut a0, mut b0, mut c0, mut d0) = (0x67452301u32, 0xefcdab89u32, 0x98badcfeu32, 0x10325476u32);
    for chunk in msg.chunks(64) {
        let w: Vec<u32> =
            (0..16).map(|i| u32::from_le_bytes([chunk[i * 4], chunk[i * 4 + 1], chunk[i * 4 + 2], chunk[i * 4 + 3]])).collect();
        let (mut a, mut b, mut c, mut d) = (a0, b0, c0, d0);
        for i in 0..64 {
            let (f, g) = match i / 16 {
                0 => ((b & c) | (!b & d), i),
                1 => ((d & b) | (!d & c), (5 * i + 1) % 16),
                2 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | !d), (7 * i) % 16),
            };
            let f = f.wrapping_add(a).wrapping_add(k[i]).wrapping_add(w[g]);
            a = d;
            d = c;
            c = b;
            b = b.wrapping_add(f.rotate_left(S[i]));
        }
        a0 = a0.wrapping_add(a);
        b0 = b0.wrapping_add(b);
        c0 = c0.wrapping_add(c);
        d0 = d0.wrapping_add(d);
    }
    [a0, b0, c0, d0].iter().flat_map(|x| x.to_le_bytes()).map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn dt(s: &str) -> NaiveDateTime {
        crate::datefmt::parse(s).unwrap()
    }

    #[test]
    fn encodes_like_php() {
        let v = json!([
            40.0,
            8.3,
            1e25,
            "a/b",
            "é",
            {},
            [],
            1e16,
            1.2345678901234568e17,
            0.0001,
            0.00001,
            1.5e-7,
            0.30000000000000004,
            "\u{1}",
            "😀"
        ]);
        assert_eq!(
            json_encode(&v),
            r#"[40,8.3,1.0e+25,"a\/b","\u00e9",[],[],10000000000000000,1.2345678901234568e+17,0.0001,1.0e-5,1.5e-7,0.30000000000000004,"\u0001","\ud83d\ude00"]"#
        );
        assert_eq!(json_encode(&json!({"0": "a", "1": "b"})), r#"["a","b"]"#);
        assert_eq!(json_encode(&json!({"1": "a", "0": "b"})), r#"{"1":"a","0":"b"}"#);
        assert_eq!(json_encode(&json!({"k": null, "b": true})), r#"{"k":null,"b":true}"#);
    }

    #[test]
    fn float_strings() {
        assert_eq!(float_string(0.5), "0.5");
        assert_eq!(float_string(2.0), "2");
        assert_eq!(float_string(0.1 + 0.2), "0.3");
        assert_eq!(float_string(-1.25), "-1.25");
        assert_eq!(float_string(1234.5), "1234.5");
        assert_eq!(float_string(0.001), "0.001");
    }

    #[test]
    fn relative_times() {
        let now = dt("2026-10-18 12:00:00");
        assert_eq!(diff_for_humans(&dt("2026-10-18 12:00:00"), &now), "1 second ago");
        assert_eq!(diff_for_humans(&dt("2026-10-18 11:59:30"), &now), "30 seconds ago");
        assert_eq!(diff_for_humans(&dt("2026-10-18 10:01:00"), &now), "1 hour ago");
        assert_eq!(diff_for_humans(&dt("2026-10-16 13:00:00"), &now), "1 day ago");
        assert_eq!(diff_for_humans(&dt("2026-10-04 12:00:00"), &now), "2 weeks ago");
        assert_eq!(diff_for_humans(&dt("2026-09-18 12:00:01"), &now), "4 weeks ago");
        assert_eq!(diff_for_humans(&dt("2026-08-19 12:00:00"), &now), "1 month ago");
        assert_eq!(diff_for_humans(&dt("2025-10-18 12:00:01"), &now), "11 months ago");
        assert_eq!(diff_for_humans(&dt("2024-01-31 00:00:00"), &now), "2 years ago");
        assert_eq!(diff_for_humans(&dt("2026-10-18 13:00:00"), &now), "1 hour from now");
    }

    #[test]
    fn months_overflow() {
        assert_eq!(add_months(&dt("2026-12-31 23:59:59"), -3), dt("2026-10-01 23:59:59"));
        assert_eq!(add_months(&dt("2026-03-31 00:00:00"), -1), dt("2026-03-03 00:00:00"));
        assert_eq!(add_months(&dt("2026-10-18 00:00:00"), -6), dt("2026-04-18 00:00:00"));
    }

    #[test]
    fn md5() {
        assert_eq!(md5_hex(b""), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(md5_hex(b"guest@example.com"), "c8c0e5b0754770c5e1f7419a0698ecff");
    }

    #[test]
    fn php_truth() {
        assert!(!truthy(&json!("0")));
        assert!(truthy(&json!("false")));
        assert!(!truthy(&json!([])));
        assert!(filter_bool(&json!("on")));
        assert!(!filter_bool(&json!("false")));
        assert_eq!(to_float(Some(&json!("2.5abc"))), 2.5);
        assert_eq!(to_float(Some(&json!("abc"))), 0.0);
    }
}
