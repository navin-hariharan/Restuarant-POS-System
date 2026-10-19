//! Request filters of the report queries. Every request key is matched to a
//! filter by name the way the previous API did it: a trailing "_id" is
//! dropped and case, "_", "-", "." and spaces are ignored, so `payment_method`,
//! `payment_method_id` and `paymentMethod` all select the same filter.
//! Empty values are skipped.

use super::php::{scalar, text};
use crate::{input::Input, query::Sql, settings::Settings};
use serde_json::Value;

pub fn filter_name(key: &str) -> String {
    let key = key.strip_suffix("_id").filter(|k| !k.is_empty()).unwrap_or(key);
    key.chars().filter(|c| !matches!(c, '.' | '_' | '-' | ' ')).flat_map(char::to_lowercase).collect()
}

/// (filter name, value) for every non-empty request value.
fn entries(input: &Input) -> impl Iterator<Item = (String, Value)> + '_ {
    input.data.iter().filter_map(|(k, v)| {
        let empty = match v {
            Value::Null => true,
            Value::String(s) => s.is_empty(),
            Value::Array(a) => a.is_empty(),
            _ => false,
        };
        if empty {
            return None;
        }
        scalar(v).map(|s| (filter_name(k), s))
    })
}

/// Sales: search (tracking), biller, customer, chef, payment method, taker,
/// table, order type and status. `t` is the table alias prefix ("" or "s.").
pub fn sales(sql: &mut Sql, input: &Input, s: &Settings, t: &str) {
    for (name, v) in entries(input) {
        let col = match name.as_str() {
            "search" => {
                sql.push_args(&format!(" AND {t}tracking LIKE ?"), [s.search_pattern(&text(&v))]);
                continue;
            }
            "status" => {
                let cond = match v.as_str() {
                    Some("cancelled") => "{t}is_cancelled = 1",
                    Some("completed") => "{t}completed_at IS NOT NULL AND {t}is_cancelled = 0",
                    Some("ready") => "{t}prepared_at IS NOT NULL AND {t}completed_at IS NULL AND {t}is_cancelled = 0",
                    Some("preparing") => {
                        "{t}is_preparing = 1 AND {t}prepared_at IS NULL AND {t}completed_at IS NULL AND {t}is_cancelled = 0"
                    }
                    Some("submitted") => "({t}progress IS NULL OR {t}progress = 0) AND {t}completed_at IS NULL AND {t}is_cancelled = 0",
                    _ => continue,
                };
                sql.push(" AND ");
                sql.push(&cond.replace("{t}", t));
                continue;
            }
            "biller" => "biller_id",
            "customer" => "customer_id",
            "chef" => "chef_id",
            "paymentmethod" => "payment_method_id",
            "taker" => "order_taker_id",
            "table" => "table_id",
            "ordertype" => "order_type",
            _ => continue,
        };
        sql.push_args(&format!(" AND {t}{col} = ?"), [v]);
    }
}

/// Sold items: search (item name) and category.
pub fn sale_items(sql: &mut Sql, input: &Input, s: &Settings) {
    for (name, v) in entries(input) {
        match name.as_str() {
            "search" => {
                sql.push_args(" AND item_name LIKE ?", [s.search_pattern(&text(&v))]);
            }
            "category" => {
                sql.push_args(" AND food_category_id = ?", [v]);
            }
            _ => {}
        }
    }
}

/// Expenses: search (title or amount) and category (expense type).
pub fn expenses(sql: &mut Sql, input: &Input, s: &Settings) {
    for (name, v) in entries(input) {
        match name.as_str() {
            "search" => {
                let p = s.search_pattern(&text(&v));
                sql.push_args(" AND (title LIKE ? OR amount LIKE ?)", [p.clone(), p]);
            }
            "category" => {
                sql.push_args(" AND expense_type_id = ?", [v]);
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(filter_name("payment_method_id"), "paymentmethod");
        assert_eq!(filter_name("paymentMethod"), "paymentmethod");
        assert_eq!(filter_name("order-type"), "ordertype");
        assert_eq!(filter_name("BILLER_ID"), "billerid");
        assert_eq!(filter_name("table_id"), "table");
        assert_eq!(filter_name("_id"), "id");
    }
}
