//! Validation helpers shared by the account, user, role and language
//! modules, producing the same English messages as the previous API, plus
//! the small bits of hashing the account screens need.

use crate::{db::Db, error::AppResult};
use serde_json::Value;

/// Display names used in validation messages (as the previous release named them).
pub fn attribute(field: &str) -> &str {
    match field {
        "role_id" => "role",
        "current_password" => "Current password",
        "user_id" => "user",
        other => other,
    }
}

pub fn required_msg(field: &str) -> String {
    format!("The {} field is required.", attribute(field))
}

pub fn max_msg(field: &str, max: usize) -> String {
    format!("The {} may not be greater than {max} characters.", attribute(field))
}

pub fn min_msg(field: &str, min: usize) -> String {
    format!("The {} must be at least {min} characters.", attribute(field))
}

pub fn email_msg(field: &str) -> String {
    format!("The {} must be a valid email address.", attribute(field))
}

pub fn taken_msg(field: &str) -> String {
    format!("The {} has already been taken.", attribute(field))
}

pub fn invalid_msg(field: &str) -> String {
    format!("The selected {} is invalid.", attribute(field))
}

/// Length in characters (multibyte aware, like mb_strlen).
pub fn len(s: &str) -> usize {
    s.chars().count()
}

/// the `boolean` rule: true, false, 0, 1, "0", "1".
pub fn is_boolean(v: &Value) -> bool {
    match v {
        Value::Bool(_) => true,
        Value::Number(n) => n.as_i64().map(|i| i == 0 || i == 1).unwrap_or(false),
        Value::String(s) => s == "0" || s == "1",
        _ => false,
    }
}

pub fn bool_value(v: &Value) -> bool {
    crate::util::truthy(v)
}

/// RFC style address check: one `@`, a sensible local part and a domain
/// made of labels (or an address literal).
pub fn is_email(s: &str) -> bool {
    if s.len() > 320 || s.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    let Some((local, domain)) = s.rsplit_once('@') else { return false };
    if local.is_empty() || domain.is_empty() || local.chars().count() > 64 {
        return false;
    }
    let local_ok = if local.starts_with('"') && local.ends_with('"') && local.len() >= 2 {
        !local[1..local.len() - 1].contains('"')
    } else {
        !local.starts_with('.')
            && !local.ends_with('.')
            && !local.contains("..")
            && local.chars().all(|c| c.is_alphanumeric() || "!#$%&'*+-/=?^_`{|}~.".contains(c))
    };
    if !local_ok {
        return false;
    }
    if domain.starts_with('[') && domain.ends_with(']') {
        let inner = &domain[1..domain.len() - 1];
        let inner = inner.strip_prefix("IPv6:").unwrap_or(inner);
        return inner.parse::<std::net::IpAddr>().is_ok();
    }
    domain.split('.').all(|label| {
        !label.is_empty()
            && label.chars().count() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label.chars().all(|c| c.is_alphanumeric() || c == '-')
    })
}

/// True when `value` is already used in `column` of `table` (both from code),
/// ignoring the row with id `except`.
pub async fn taken(db: &Db, table: &'static str, column: &'static str, value: &str, except: Option<i64>) -> AppResult<bool> {
    let mut sql = format!("SELECT COUNT(*) FROM `{table}` WHERE `{column}` = ?");
    if except.is_some() {
        sql.push_str(" AND id <> ?");
    }
    let mut q = sqlx::query_scalar::<_, i64>(&sql).bind(value);
    if let Some(id) = except {
        q = q.bind(id);
    }
    Ok(q.fetch_one(db).await? > 0)
}

/// MD5 hex digest (for Gravatar addresses only, never for secrets).
pub fn md5_hex(input: &[u8]) -> String {
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    let k: Vec<u32> = (0..64).map(|i| ((i as f64 + 1.0).sin().abs() * 4294967296.0) as u32).collect();
    let (mut a0, mut b0, mut c0, mut d0): (u32, u32, u32, u32) = (0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476);
    let mut msg = input.to_vec();
    let bit_len = (input.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_le_bytes());
    for chunk in msg.chunks(64) {
        let m: Vec<u32> = chunk.chunks(4).map(|w| u32::from_le_bytes([w[0], w[1], w[2], w[3]])).collect();
        let (mut a, mut b, mut c, mut d) = (a0, b0, c0, d0);
        for i in 0..64 {
            let (f, g) = match i / 16 {
                0 => ((b & c) | (!b & d), i),
                1 => ((d & b) | (!d & c), (5 * i + 1) % 16),
                2 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | !d), (7 * i) % 16),
            };
            let f = f.wrapping_add(a).wrapping_add(k[i]).wrapping_add(m[g]);
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
    [a0, b0, c0, d0].iter().flat_map(|w| w.to_le_bytes()).map(|b| format!("{b:02x}")).collect()
}

/// Constant-time comparison of two secrets.
pub fn secure_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Width and height of a PNG, JPEG, GIF, WEBP or BMP image, read from its header.
pub fn image_size(b: &[u8]) -> Option<(u32, u32)> {
    let be16 = |i: usize| -> Option<u32> { Some(u16::from_be_bytes([*b.get(i)?, *b.get(i + 1)?]) as u32) };
    let le16 = |i: usize| -> Option<u32> { Some(u16::from_le_bytes([*b.get(i)?, *b.get(i + 1)?]) as u32) };
    let be32 = |i: usize| -> Option<u32> { Some(u32::from_be_bytes([*b.get(i)?, *b.get(i + 1)?, *b.get(i + 2)?, *b.get(i + 3)?])) };
    let le32 = |i: usize| -> Option<i32> { Some(i32::from_le_bytes([*b.get(i)?, *b.get(i + 1)?, *b.get(i + 2)?, *b.get(i + 3)?])) };
    match crate::uploads::image_ext(b)? {
        "png" => Some((be32(16)?, be32(20)?)),
        "gif" => Some((le16(6)?, le16(8)?)),
        "bmp" => Some((le32(18)?.unsigned_abs(), le32(22)?.unsigned_abs())),
        "webp" => match b.get(12..16)? {
            b"VP8 " => Some((le16(26)? & 0x3fff, le16(28)? & 0x3fff)),
            b"VP8L" => {
                let v = u32::from_le_bytes([*b.get(21)?, *b.get(22)?, *b.get(23)?, *b.get(24)?]);
                Some(((v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1))
            }
            b"VP8X" => {
                let w = u32::from_le_bytes([*b.get(24)?, *b.get(25)?, *b.get(26)?, 0]) + 1;
                let h = u32::from_le_bytes([*b.get(27)?, *b.get(28)?, *b.get(29)?, 0]) + 1;
                Some((w, h))
            }
            _ => None,
        },
        "jpg" => {
            let mut i = 2;
            while i + 9 < b.len() {
                if b[i] != 0xFF {
                    i += 1;
                    continue;
                }
                let marker = b[i + 1];
                if marker == 0xFF {
                    i += 1;
                    continue;
                }
                if (0xD0..=0xD9).contains(&marker) || marker == 0x01 {
                    i += 2;
                    continue;
                }
                let seg = be16(i + 2)? as usize;
                // Start-of-frame markers carry the dimensions
                if matches!(marker, 0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF) {
                    return Some((be16(i + 7)?, be16(i + 5)?));
                }
                i += 2 + seg;
            }
            None
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn md5_known_values() {
        assert_eq!(md5_hex(b""), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(md5_hex(b"The quick brown fox jumps over the lazy dog"), "9e107d9d372bb6826bd81d3542a419d6");
        assert_eq!(md5_hex(b"abc"), "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(
            md5_hex(b"12345678901234567890123456789012345678901234567890123456789012345678901234567890"),
            "57edf4a22be3c955ac49da2e2107b67a"
        );
    }

    #[test]
    fn emails() {
        assert!(is_email("a@b.co"));
        assert!(is_email("first.last+tag@example.com"));
        assert!(is_email("user@localhost"));
        assert!(!is_email("plainaddress"));
        assert!(!is_email("a@"));
        assert!(!is_email("@b.com"));
        assert!(!is_email("a b@c.com"));
        assert!(!is_email("a..b@c.com"));
        assert!(!is_email("a@b..com"));
        assert!(!is_email("a@-b.com"));
    }

    #[test]
    fn booleans() {
        for v in [json!(true), json!(false), json!(0), json!(1), json!("0"), json!("1")] {
            assert!(is_boolean(&v));
        }
        for v in [json!("true"), json!(2), json!("yes"), json!(null)] {
            assert!(!is_boolean(&v));
        }
    }

    #[test]
    fn image_sizes() {
        let mut png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, b'I', b'H', b'D', b'R'];
        png.extend_from_slice(&40u32.to_be_bytes());
        png.extend_from_slice(&30u32.to_be_bytes());
        assert_eq!(image_size(&png), Some((40, 30)));
        let gif = [b'G', b'I', b'F', b'8', b'9', b'a', 10, 0, 20, 0];
        assert_eq!(image_size(&gif), Some((10, 20)));
    }

    #[test]
    fn constant_time_eq() {
        assert!(secure_eq(b"abc", b"abc"));
        assert!(!secure_eq(b"abc", b"abd"));
        assert!(!secure_eq(b"abc", b"ab"));
    }
}
