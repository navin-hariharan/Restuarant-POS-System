//! Exports of master data as CSV, XLSX, XLS or HTML. The first row holds the
//! column names the importer reads; data columns follow the table's own
//! column order, like the previous release's files.

use crate::{db::RowExt, error::AppResult, state::AppState};
use serde_json::{Map, Value};

#[derive(Debug, Clone, PartialEq)]
pub enum Cell {
    Empty,
    Text(String),
    Num(f64),
    Bool(bool),
}

#[derive(Clone, Copy)]
enum Kind {
    Text,
    Num,
    /// DECIMAL column: read as text, so a zero is still written
    Dec,
    /// Stored 0/1; true shows as TRUE, false as an empty cell.
    Flag,
    /// JSON text, written in compact JSON
    Json,
}

pub struct Resource {
    pub table: &'static str,
    pub file: &'static str,
    headings: &'static [&'static str],
    columns: &'static [(&'static str, Kind)],
}

use Kind::*;

/// Export resources by request key.
pub fn resource(key: &str) -> Option<Resource> {
    let r = |table, file, headings, columns| Some(Resource { table, file, headings, columns });
    match key {
        "categories" => r("food_categories", "Food_categories", &["name"], &[("name", Text)]),
        "customers" => r(
            "customers",
            "Customers",
            &["name", "phone", "email", "address"],
            &[("name", Text), ("phone", Text), ("email", Text), ("address", Text), ("shipping_addresses", Json)],
        ),
        "servicetables" => r("service_tables", "Service_tables", &["title"], &[("title", Text)]),
        "products" => r(
            "food_items",
            "Food_items",
            &["sku", "name", "price", "cost", "food_category_id", "description", "is_bar_type", "tax_id", "expiry_date"],
            &[
                ("sku", Text),
                ("name", Text),
                ("price", Num),
                ("cost", Num),
                ("food_category_id", Num),
                ("description", Text),
                ("is_bar_type", Flag),
                ("tax_id", Num),
                ("expiry_date", Text),
            ],
        ),
        "expenses" => r(
            "expenses",
            "Expenses",
            &["title", "amount", "description", "expense_type_id"],
            &[
                ("title", Text),
                ("amount", Num),
                ("description", Text),
                ("expense_type_id", Num),
                ("expense_date", Text),
                ("cash_book_id", Num),
            ],
        ),
        "expensetypes" => r("expense_types", "Expense_types", &["title"], &[("title", Text)]),
        "modifiers" => r(
            "modifiers",
            "Modifiers",
            &["title", "price", "cost", "food_category_id"],
            &[("title", Text), ("price", Num), ("cost", Num), ("food_category_id", Num)],
        ),
        "ingredients" => r(
            "ingredients",
            "Ingredients",
            &["name", "price", "cost", "unit", "quantity", "alert_quantity", "description"],
            &[
                ("name", Text),
                ("price", Num),
                ("cost", Num),
                ("unit", Text),
                ("quantity", Num),
                ("alert_quantity", Text),
                ("description", Text),
            ],
        ),
        "paymentmethods" => r("payment_methods", "Payment_methods", &["title"], &[("title", Text)]),
        "pickuppoints" => r(
            "pickup_points",
            "pickup_points",
            &["place_title", "person_name", "phone", "address"],
            &[("place_title", Text), ("person_name", Text), ("phone", Text), ("address", Text)],
        ),
        "bookingsources" => r("booking_sources", "bookig_sources", &["title"], &[("title", Text)]),
        "reservationstatuses" => r("reservation_statuses", "reservation_statuses", &["title"], &[("title", Text)]),
        "guestrooms" => r(
            "guest_rooms",
            "guest_rooms",
            &["room_name", "capactity", "per_hour_charges"],
            &[("room_name", Text), ("capactity", Text), ("per_hour_charges", Dec), ("per_use_charges", Dec)],
        ),
        _ => None,
    }
}

/// PHP-style JSON text (escaped slashes and non-ASCII characters).
fn php_json(v: &Value) -> String {
    let s = serde_json::to_string(v).unwrap_or_default();
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '/' => out.push_str("\\/"),
            c if (c as u32) < 0x80 => out.push(c),
            c => {
                let mut buf = [0u16; 2];
                for u in c.encode_utf16(&mut buf) {
                    out.push_str(&format!("\\u{:04x}", u));
                }
            }
        }
    }
    out
}

fn cell(row: &Map<String, Value>, col: &str, kind: Kind) -> Cell {
    let v = row.val(col);
    if v.is_null() {
        return Cell::Empty;
    }
    match kind {
        Text => Cell::Text(row.str(col)),
        // zero values were written as empty cells
        Num => {
            let n = row.f64(col);
            if n == 0.0 {
                Cell::Empty
            } else {
                Cell::Num(n)
            }
        }
        Dec => Cell::Num(row.f64(col)),
        Flag => {
            if row.bool(col) {
                Cell::Bool(true)
            } else {
                Cell::Empty
            }
        }
        Json => match super::super::reports::php::json_text(row.opt_str(col).as_deref()) {
            Value::Null => Cell::Empty,
            Value::Array(a) if a.is_empty() => Cell::Empty,
            Value::Object(o) if o.is_empty() => Cell::Empty,
            j => Cell::Text(php_json(&j)),
        },
    }
}

/// Header row plus one row per record, ordered by id.
pub async fn rows(state: &AppState, res: &Resource) -> AppResult<Vec<Vec<Cell>>> {
    let cols: Vec<String> = res.columns.iter().map(|(c, _)| crate::db::ident(c)).collect();
    let sql = format!("SELECT {} FROM {} ORDER BY id", cols.join(", "), crate::db::ident(res.table));
    let records = crate::query::Sql::new(sql).fetch_all(&state.db).await?;
    let width = res.columns.len().max(res.headings.len());
    let mut out = Vec::with_capacity(records.len() + 1);
    let mut head: Vec<Cell> = res.headings.iter().map(|h| Cell::Text(h.to_string())).collect();
    head.resize(width, Cell::Empty);
    out.push(head);
    for r in &records {
        out.push(res.columns.iter().map(|(c, k)| cell(r, c, *k)).collect());
    }
    Ok(out)
}

/// Text that a spreadsheet would run as a formula gets a leading quote.
pub fn guard(s: &str) -> String {
    if s.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{s}")
    } else {
        s.to_string()
    }
}

/// The same rows with formula-like text guarded.
pub fn guarded(rows: Vec<Vec<Cell>>) -> Vec<Vec<Cell>> {
    rows.into_iter().map(|r| r.into_iter().map(|c| if let Cell::Text(t) = c { Cell::Text(guard(&t)) } else { c }).collect()).collect()
}

/// Number as text: whole numbers without decimals.
pub fn num_text(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

fn cell_text(c: &Cell) -> String {
    match c {
        Cell::Empty => String::new(),
        Cell::Text(t) => t.clone(),
        Cell::Num(n) => num_text(*n),
        Cell::Bool(b) => if *b { "TRUE" } else { "FALSE" }.to_string(),
    }
}

pub fn csv(rows: &[Vec<Cell>]) -> Vec<u8> {
    let mut out = String::new();
    for row in rows {
        let fields: Vec<String> = row.iter().map(|c| format!("\"{}\"", cell_text(c).replace('"', "\"\""))).collect();
        out.push_str(&fields.join(","));
        out.push('\n');
    }
    out.into_bytes()
}

pub fn xlsx(rows: &[Vec<Cell>]) -> anyhow::Result<Vec<u8>> {
    let mut wb = rust_xlsxwriter::Workbook::new();
    let ws = wb.add_worksheet();
    ws.set_name("Worksheet")?;
    for (r, row) in rows.iter().enumerate() {
        for (c, cell) in row.iter().enumerate() {
            let (r, c) = (r as u32, c as u16);
            match cell {
                Cell::Empty => {}
                Cell::Text(t) => {
                    ws.write_string(r, c, t)?;
                }
                Cell::Num(n) => {
                    ws.write_number(r, c, *n)?;
                }
                Cell::Bool(b) => {
                    ws.write_boolean(r, c, *b)?;
                }
            }
        }
    }
    Ok(wb.save_to_buffer()?)
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#039;")
}

pub fn html(title: &str, rows: &[Vec<Cell>]) -> Vec<u8> {
    let mut out =
        String::from("<!DOCTYPE html>\n<html>\n  <head>\n    <meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\" />\n");
    out.push_str(&format!("    <title>{}</title>\n", escape_html(title)));
    out.push_str(
        "    <style type=\"text/css\">\n      html { font-family:Calibri, Arial, Helvetica, sans-serif; font-size:11pt; background-color:white }\n      \
         table { border-collapse:collapse }\n      td { padding:2px 6px; vertical-align:bottom }\n      .s { text-align:left }\n      \
         .n { text-align:right }\n      .b { text-align:center }\n    </style>\n  </head>\n  <body>\n    \
         <table border='0' cellpadding='0' cellspacing='0' id='sheet0' class='sheet0 gridlines'>\n      <tbody>\n",
    );
    for (r, row) in rows.iter().enumerate() {
        out.push_str(&format!("        <tr class=\"row{r}\">\n"));
        for (c, cell) in row.iter().enumerate() {
            let (class, text) = match cell {
                Cell::Empty => ("", "&nbsp;".to_string()),
                Cell::Text(t) => (" s", escape_html(t)),
                Cell::Num(n) => (" n", num_text(*n)),
                Cell::Bool(b) => (" b", if *b { "TRUE" } else { "FALSE" }.to_string()),
            };
            out.push_str(&format!("          <td class=\"column{c} style0{class}\">{text}</td>\n"));
        }
        out.push_str("        </tr>\n");
    }
    out.push_str("      </tbody>\n    </table>\n  </body>\n</html>\n");
    out.into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn guards_formulas() {
        assert_eq!(guard("=SUM(A1)"), "'=SUM(A1)");
        assert_eq!(guard("-5"), "'-5");
        assert_eq!(guard("@x"), "'@x");
        assert_eq!(guard("\tx"), "'\tx");
        assert_eq!(guard("plain"), "plain");
    }

    #[test]
    fn csv_quotes_everything() {
        let rows = vec![
            vec![Cell::Text("a\"b".into()), Cell::Num(12.0), Cell::Num(1.5), Cell::Empty, Cell::Bool(true)],
            vec![Cell::Text("=1+1".into())],
        ];
        assert_eq!(String::from_utf8(csv(&guarded(rows))).unwrap(), "\"a\"\"b\",\"12\",\"1.5\",\"\",\"TRUE\"\n\"'=1+1\"\n");
    }

    #[test]
    fn json_like_php() {
        assert_eq!(php_json(&json!(["a/b", "\u{e9}"])), "[\"a\\/b\",\"\\u00e9\"]");
    }
}
