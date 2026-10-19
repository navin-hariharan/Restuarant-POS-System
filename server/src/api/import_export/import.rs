//! CSV imports of master data. The first row names the columns; each later
//! row is validated and inserted in turn inside one transaction, so a bad row
//! stops the import and nothing is saved.

use crate::error::AppResult;
use regex::Regex;
use sqlx::{MySql, Transaction};
use std::{collections::HashMap, sync::LazyLock};

/// Most data rows accepted in one file.
pub const MAX_ROWS: usize = 20_000;
/// Largest file accepted (bytes).
pub const MAX_BYTES: usize = 10 * 1024 * 1024;

#[derive(Clone, Copy, Debug)]
pub enum Rule {
    Required,
    /// unique in (table, column)
    Unique(&'static str, &'static str),
    /// exists in (table, id)
    Exists(&'static str),
    Numeric,
    Date,
    Boolean,
    Max(usize),
}

pub struct Spec {
    pub rules: &'static [(&'static str, &'static [Rule])],
}

use Rule::*;

pub fn spec(key: &str) -> Option<Spec> {
    let s = |_table: &str, rules| Some(Spec { rules });
    match key {
        "categories" => s("food_categories", &[("name", &[Required, Unique("food_categories", "name")])]),
        "customers" => s(
            "customers",
            &[("name", &[Required, Max(255)]), ("email", &[Unique("customers", "email")]), ("phone", &[]), ("address", &[Max(255)])],
        ),
        "servicetables" => s("service_tables", &[("title", &[Required, Unique("service_tables", "title")])]),
        "products" => s(
            "food_items",
            &[
                ("name", &[Required, Unique("food_items", "name")]),
                ("sku", &[Unique("food_items", "sku")]),
                ("cost", &[Required, Numeric]),
                ("price", &[Required, Numeric]),
                ("food_category_id", &[Exists("food_categories")]),
                ("description", &[]),
                ("tax_id", &[Exists("taxes")]),
                ("expiry_date", &[Date]),
                ("is_bar_type", &[Boolean]),
            ],
        ),
        "modifiers" => s(
            "modifiers",
            &[
                ("title", &[Required, Unique("modifiers", "title")]),
                ("price", &[Required, Numeric]),
                ("cost", &[Required, Numeric]),
                ("food_category_id", &[Required, Exists("food_categories")]),
            ],
        ),
        "ingredients" => s(
            "ingredients",
            &[
                ("name", &[Required, Unique("ingredients", "name")]),
                ("price", &[Required, Numeric]),
                ("cost", &[Required, Numeric]),
                ("quantity", &[Required, Numeric]),
                ("alert_quantity", &[Required]),
                ("description", &[]),
            ],
        ),
        "expenses" => s(
            "expenses",
            &[
                ("title", &[Required, Unique("expenses", "title")]),
                ("amount", &[Required, Numeric]),
                ("expense_type_id", &[Required, Exists("expense_types")]),
                ("description", &[]),
            ],
        ),
        "expensetypes" => s("expense_types", &[("title", &[Required, Unique("expense_types", "title")])]),
        "paymentmethods" => s("payment_methods", &[("title", &[Required, Unique("payment_methods", "title")])]),
        "pickuppoints" => s(
            "pickup_points",
            &[("place_title", &[Required, Unique("pickup_points", "place_title")]), ("person_name", &[]), ("phone", &[]), ("address", &[])],
        ),
        "bookingsources" => s("booking_sources", &[("title", &[Required, Unique("booking_sources", "title")])]),
        "reservationstatuses" => s("reservation_statuses", &[("title", &[Required, Unique("reservation_statuses", "title")])]),
        "guestrooms" => s(
            "guest_rooms",
            &[("room_name", &[Required, Unique("guest_rooms", "room_name")]), ("per_hour_charges", &[Numeric])],
        ),
        _ => None,
    }
}

/// Column name as written in a heading: lower case, words joined by "_".
pub fn slug(heading: &str) -> String {
    let s = heading.replace('-', "_").replace('@', "_at_");
    let kept: String = s.chars().filter(|c| c.is_alphanumeric() || *c == '_' || c.is_whitespace()).collect();
    let lower = kept.to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut sep = false;
    for c in lower.chars() {
        if c == '_' || c.is_whitespace() {
            sep = true;
        } else {
            if sep && !out.is_empty() {
                out.push('_');
            }
            sep = false;
            out.push(c);
        }
    }
    out
}

/// Records of a CSV text. A blank line is a record with one empty field.
pub fn parse_csv(text: &str) -> Vec<Vec<String>> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut records = Vec::new();
    let mut record = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    let mut any = false;
    while let Some(c) = chars.next() {
        any = true;
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    field.push('"');
                } else {
                    quoted = false;
                }
            } else {
                field.push(c);
            }
            continue;
        }
        match c {
            '"' if field.is_empty() => quoted = true,
            ',' => record.push(std::mem::take(&mut field)),
            '\r' | '\n' => {
                if c == '\r' && chars.peek() == Some(&'\n') {
                    chars.next();
                }
                record.push(std::mem::take(&mut field));
                records.push(std::mem::take(&mut record));
                any = false;
            }
            _ => field.push(c),
        }
    }
    if any {
        record.push(field);
        records.push(record);
    }
    records
}

/// Rows keyed by heading slug; empty cells are None. Trailing empty rows are
/// dropped, empty rows in between are kept (and fail "required" rules).
pub fn rows(text: &str) -> Vec<HashMap<String, Option<String>>> {
    let mut records = parse_csv(text);
    while records.last().is_some_and(|r| r.iter().all(String::is_empty)) {
        records.pop();
    }
    let mut it = records.into_iter();
    let Some(head) = it.next() else { return vec![] };
    let head: Vec<String> = head.iter().map(|h| slug(h)).collect();
    it.map(|rec| {
        let mut m = HashMap::new();
        for (i, h) in head.iter().enumerate() {
            let v = rec.get(i).filter(|v| !v.is_empty()).cloned();
            m.insert(h.clone(), v);
        }
        m
    })
    .collect()
}

static NUMERIC: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$").expect("regex"));

pub fn numeric(v: &str) -> Option<f64> {
    let t = v.trim();
    if NUMERIC.is_match(t) {
        t.parse::<f64>().ok().filter(|f| f.is_finite())
    } else {
        None
    }
}

fn is_date(v: &str) -> bool {
    let t = v.trim();
    ["%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y", "%d.%m.%Y", "%m/%d/%Y", "%d %B %Y", "%d %b %Y", "%B %d %Y", "%b %d %Y"]
        .iter()
        .any(|f| chrono::NaiveDate::parse_from_str(t, f).is_ok())
        || ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"]
            .iter()
            .any(|f| chrono::NaiveDateTime::parse_from_str(t, f).is_ok())
}

/// A failed rule: the message template and its :attribute.
pub struct Failure {
    pub attribute: String,
    pub template: &'static str,
    pub max: Option<usize>,
}

async fn count(tx: &mut Transaction<'_, MySql>, sql: &str, v: &str) -> AppResult<i64> {
    Ok(sqlx::query_scalar::<_, i64>(sql).bind(v).fetch_one(&mut **tx).await?)
}

/// Failures of one row, in rule order. Empty optional cells are not checked.
pub async fn validate(tx: &mut Transaction<'_, MySql>, spec: &Spec, row: &HashMap<String, Option<String>>) -> AppResult<Vec<Failure>> {
    let mut out = Vec::new();
    for (attr, rules) in spec.rules {
        let v = row.get(*attr).cloned().flatten();
        let fail = |template: &'static str, max: Option<usize>| Failure { attribute: attr.to_string(), template, max };
        let Some(v) = v.filter(|v| !v.trim().is_empty()) else {
            if rules.iter().any(|r| matches!(r, Required)) {
                out.push(fail(tr!("The :attribute field is required."), None));
            }
            continue;
        };
        for rule in *rules {
            match rule {
                Required => {}
                Unique(table, col) => {
                    let sql = format!("SELECT COUNT(*) FROM {} WHERE {} = ?", crate::db::ident(table), crate::db::ident(col));
                    if count(tx, &sql, &v).await? > 0 {
                        out.push(fail(tr!("The :attribute has already been taken."), None));
                    }
                }
                Exists(table) => {
                    let sql = format!("SELECT COUNT(*) FROM {} WHERE id = ?", crate::db::ident(table));
                    if count(tx, &sql, &v).await? == 0 {
                        out.push(fail(tr!("The selected :attribute is invalid."), None));
                    }
                }
                Numeric => {
                    if numeric(&v).is_none() {
                        out.push(fail(tr!("The :attribute must be a number."), None));
                    }
                }
                Date => {
                    if !is_date(&v) {
                        out.push(fail(tr!("The :attribute field must be a valid date."), None));
                    }
                }
                Boolean => {
                    if !matches!(v.trim().to_ascii_lowercase().as_str(), "0" | "1" | "true" | "false") {
                        out.push(fail(tr!("The :attribute field must be true or false."), None));
                    }
                }
                Max(n) => {
                    if v.chars().count() > *n {
                        out.push(fail(tr!("The :attribute may not be greater than :max characters."), Some(*n)));
                    }
                }
            }
        }
    }
    Ok(out)
}

/// Product code from the name: three letters and six digits, e.g. "CHI-482913".
pub fn sku(name: &str) -> String {
    use rand::Rng;
    let studly: String = name
        .replace(['-', '_'], " ")
        .split(' ')
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect();
    let prefix: String = studly.chars().take(3).collect();
    let digits: String = (0..6).map(|_| char::from(b'0' + rand::rng().random_range(0..10u8))).collect();
    format!("{}-{}", prefix.trim_end(), digits).to_uppercase()
}

/// Insert one validated row.
pub async fn insert(tx: &mut Transaction<'_, MySql>, key: &str, row: &HashMap<String, Option<String>>, now: chrono::NaiveDateTime) -> AppResult<()> {
    let get = |k: &str| row.get(k).cloned().flatten();
    let num = |k: &str| get(k).and_then(|v| numeric(&v));
    let q = match key {
        "products" => {
            let name = get("name").unwrap_or_default();
            let sku_val = get("sku").filter(|s| s != "0").unwrap_or_else(|| sku(&name));
            sqlx::query(
                "INSERT INTO food_items (uuid, sku, name, cost, price, food_category_id, description, tax_id, expiry_date, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(crate::util::uuid())
            .bind(sku_val)
            .bind(name)
            .bind(num("cost").unwrap_or(0.0))
            .bind(num("price").unwrap_or(0.0))
            .bind(get("food_category_id").unwrap_or_else(|| "1".into()))
            .bind(get("description").or_else(|| get("discription")))
            .bind(get("tax_id").unwrap_or_else(|| "1".into()))
            .bind(get("expiry_date"))
        }
        "customers" => sqlx::query(
            "INSERT INTO customers (uuid, name, email, phone, address, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(crate::util::uuid())
        .bind(get("name"))
        .bind(get("email"))
        .bind(get("phone"))
        .bind(get("address")),
        "modifiers" => sqlx::query(
            "INSERT INTO modifiers (title, price, cost, food_category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(get("title"))
        .bind(num("price"))
        .bind(num("cost"))
        .bind(get("food_category_id")),
        "ingredients" => sqlx::query(
            "INSERT INTO ingredients (name, price, cost, unit, quantity, alert_quantity, description, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(get("name"))
        .bind(num("price"))
        .bind(num("cost"))
        .bind(get("unit").unwrap_or_default())
        .bind(num("quantity").map(|q| q.round() as i64))
        .bind(get("alert_quantity"))
        .bind(get("description")),
        "expenses" => sqlx::query(
            "INSERT INTO expenses (title, amount, description, expense_type_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(get("title"))
        .bind(num("amount"))
        .bind(get("description"))
        .bind(get("expense_type_id")),
        "pickuppoints" => sqlx::query(
            "INSERT INTO pickup_points (place_title, person_name, phone, address, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(get("place_title"))
        .bind(get("person_name"))
        .bind(get("phone"))
        .bind(get("address")),
        "guestrooms" => sqlx::query(
            "INSERT INTO guest_rooms (room_name, capactity, per_hour_charges, created_at, updated_at) \
             VALUES (?, COALESCE(?, '1'), COALESCE(?, 0), ?, ?)",
        )
        .bind(get("room_name"))
        .bind(get("capactity"))
        .bind(num("per_hour_charges")),
        "categories" => sqlx::query("INSERT INTO food_categories (name, created_at, updated_at) VALUES (?, ?, ?)").bind(get("name")),
        "servicetables" => sqlx::query("INSERT INTO service_tables (title, created_at, updated_at) VALUES (?, ?, ?)").bind(get("title")),
        "expensetypes" => sqlx::query("INSERT INTO expense_types (title, created_at, updated_at) VALUES (?, ?, ?)").bind(get("title")),
        "paymentmethods" => sqlx::query("INSERT INTO payment_methods (title, created_at, updated_at) VALUES (?, ?, ?)").bind(get("title")),
        "bookingsources" => sqlx::query("INSERT INTO booking_sources (title, created_at, updated_at) VALUES (?, ?, ?)").bind(get("title")),
        "reservationstatuses" => {
            sqlx::query("INSERT INTO reservation_statuses (title, created_at, updated_at) VALUES (?, ?, ?)").bind(get("title"))
        }
        _ => return Ok(()),
    };
    q.bind(now).bind(now).execute(&mut **tx).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs() {
        assert_eq!(slug("Food Category ID"), "food_category_id");
        assert_eq!(slug(" name* "), "name");
        assert_eq!(slug("E-mail"), "e_mail");
        assert_eq!(slug("alert__quantity"), "alert_quantity");
    }

    #[test]
    fn csv_records() {
        let r = parse_csv("\u{feff}a,b\r\n\"x, \"\"y\"\"\",2\n\n\"multi\nline\",3\n");
        assert_eq!(r, vec![vec!["a", "b"], vec!["x, \"y\"", "2"], vec![""], vec!["multi\nline", "3"]]);
        let rows = rows("Title\nA\n\nB\n\n,\n");
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[1]["title"], None);
    }

    #[test]
    fn numbers_and_skus() {
        assert_eq!(numeric(" 1e2 "), Some(100.0));
        assert_eq!(numeric("inf"), None);
        assert_eq!(numeric("12abc"), None);
        let s = sku("chicken wings");
        assert!(s.starts_with("CHI-") && s.len() == 10, "{s}");
        assert!(is_date("2026-12-01") && !is_date("bad"));
    }
}
