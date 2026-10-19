//! Public digital menu (QR code on the table): browse the menu and place an
//! order. Nothing priced comes from the guest: prices, costs, taxes and
//! totals are rebuilt from the database, and only the choice of products,
//! variants, modifiers, quantities and notes is taken from the request.

use super::pos::{
    common::{self, fk_id, set_table_booked, tx_exec, tx_row, Row, SaleData},
    missing, php,
};
use crate::{
    db::RowExt,
    error::{AppError, AppResult, Errors},
    input::Input,
    notify::{self, OrderEvent},
    query::Sql,
    settings::Settings,
    state::AppState,
};
use axum::{extract::State, routing::{get, post}, Json, Router};
use rust_decimal::{prelude::ToPrimitive, Decimal, RoundingStrategy};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/digital-menu/order-collect", post(collect_order))
        .route("/digital-menu/categories", get(categories))
        .route("/digital-menu/products", get(products))
        .route("/digital-menu/taxes", get(taxes))
        .route("/digital-menu/modifiers", get(modifiers))
        .route("/digital-menu/tables", get(tables))
}

async fn categories(State(state): State<AppState>) -> AppResult<Json<Value>> {
    Ok(common::reply(Value::Array(super::pos::category_list(&state).await?)))
}

async fn products(State(state): State<AppState>, mut input: Input) -> AppResult<Json<Value>> {
    // a guest browsing the menu does not need huge pages
    let per = input.i64("perPage").or_else(|| input.i64("per_page")).unwrap_or(18).clamp(1, 100);
    input.data.insert("perPage".into(), Value::from(per));
    input.data.remove("per_page");
    Ok(common::reply(super::pos::product_page(&state, &input, true).await?))
}

async fn taxes(State(state): State<AppState>) -> AppResult<Json<Value>> {
    let s = state.settings.get().await;
    let rows = Sql::new("SELECT * FROM taxes ORDER BY id").fetch_all(&state.db).await?;
    Ok(common::reply(Value::Array(rows.iter().map(|r| common::pos_tax(&s, r)).collect())))
}

async fn modifiers(State(state): State<AppState>) -> AppResult<Json<Value>> {
    Ok(common::reply(Value::Array(super::pos::modifier_list(&state, true).await?)))
}

async fn tables(State(state): State<AppState>) -> AppResult<Json<Value>> {
    Ok(common::reply(Value::Array(super::pos::table_list(&state).await?)))
}

/* ------------------------------------------------------------ ordering */

const MAX_LINES: usize = 100;
const MAX_QTY: i64 = 1000;
const MAX_MODIFIER_QTY: i64 = 100;

/// `Number(x.toFixed(2))`: two decimals from the exact binary value, ties away from zero.
pub fn to_fixed2(v: f64) -> f64 {
    Decimal::from_f64_retain(v)
        .map(|d| d.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero))
        .and_then(|d| d.to_f64())
        .unwrap_or(0.0)
}

/// Money rounding of stored totals (`Math.round((n + EPSILON) * 100) / 100`).
fn money(v: f64) -> f64 {
    ((v + f64::EPSILON) * 100.0).round() / 100.0
}

/// A tax setup as the cart sees it.
#[derive(Clone, Copy, Default)]
pub struct TaxRule {
    pub rate: f64,
    pub vat: bool,
    pub fixed: bool,
    pub included: bool,
}

impl TaxRule {
    fn from_json(v: &Value) -> Self {
        let get = |k: &str| v.get(k).cloned().unwrap_or(Value::Null);
        let rate = match get("tax_rate") {
            Value::Null => php::to_float(v.get("rate")),
            r => php::to_float(Some(&r)),
        };
        let t = |k: &str| matches!(get(k), Value::Bool(true)) || get(k) == json!(1) || get(k) == json!("1") || get(k) == json!("true");
        TaxRule { rate, vat: t("is_vat"), fixed: t("is_tax_fix"), included: t("is_tax_included") }
    }

    /// Tax on `base` (VAT / fixed / percent), rounded to cents like the till.
    pub fn tax_for(&self, base: f64) -> f64 {
        let value = if self.vat {
            if self.included {
                base - base / (1.0 + self.rate / 100.0)
            } else {
                base * (self.rate / 100.0)
            }
        } else if self.fixed {
            self.rate
        } else {
            base * (self.rate / 100.0)
        };
        to_fixed2(value)
    }
}

/// The order tax setup from Settings > Tax (the shape the web app sends).
fn order_tax(s: &Settings) -> Value {
    let rate = crate::util::json_num(s.row.f64("tax_rate"));
    json!({
        "tax_title": s.row.val("tax_title"),
        "rate": rate,
        "tax_rate": rate,
        "is_tax_fix": s.flag("is_tax_fix"),
        "is_tax_included": s.flag("is_tax_included"),
        "tax_id": s.row.opt_str("tax_id"),
        "is_vat": s.flag("is_vat"),
    })
}

struct Totals {
    items: f64,
    /// before discount and tax
    #[cfg_attr(not(test), allow(dead_code))]
    price: f64,
    cost: f64,
    net: f64,
    tax: f64,
    total: f64,
    profit: f64,
    progress: i64,
}

/// orderTotals() of the web app, without discount or tip.
fn totals(lines: &[Value], item_based: bool, tax: &TaxRule) -> Totals {
    let f = |l: &Value, k: &str| php::to_float(l.get(k));
    let items: f64 = lines.iter().map(|l| f(l, "qty")).sum();
    let price: f64 = lines.iter().map(|l| f(l, "sub_total")).sum();
    let cost: f64 = lines.iter().map(|l| f(l, "cost") * f(l, "qty") + f(l, "modifiers_cost")).sum();
    let after = price;
    let tax_amount = if item_based { lines.iter().map(|l| f(l, "tax_amount")).sum() } else { tax.tax_for(after) };
    let net = if item_based {
        lines.iter().map(|l| f(l, "sub_total_before_tax")).sum()
    } else if tax.included {
        price - tax_amount
    } else {
        price
    };
    let total = if item_based || tax.included { after } else { after + tax_amount };
    let ready = lines.iter().filter(|l| l.get("is_ready").and_then(Value::as_bool).unwrap_or(false)).count();
    let progress = if lines.is_empty() { 0 } else { ((ready as f64 / lines.len() as f64) * 100.0).round() as i64 };
    Totals { items, price, cost, net, tax: tax_amount, total, profit: after - cost, progress }
}

fn whole(v: Option<&Value>, min: i64, max: i64) -> Option<i64> {
    let f = match v? {
        Value::Number(n) => n.as_f64()?,
        Value::String(s) => s.trim().parse::<f64>().ok()?,
        _ => return None,
    };
    (f.fract() == 0.0 && f >= min as f64 && f <= max as f64).then_some(f as i64)
}

fn clip(v: Option<&Value>, max: usize) -> Option<String> {
    v.and_then(Value::as_str).map(|s| s.chars().take(max).collect::<String>()).filter(|s| !s.trim().is_empty())
}

/// Simple e-mail shape check (the `email` rule accepts RFC addresses).
fn valid_email(e: &str) -> bool {
    let Some((local, domain)) = e.rsplit_once('@') else { return false };
    !local.is_empty() && !domain.is_empty() && !e.chars().any(|c| c.is_whitespace() || c.is_control()) && !domain.starts_with('.') && !domain.ends_with('.')
}

/// Catalogue rows needed to price the requested lines.
struct Catalogue {
    products: HashMap<i64, Row>,
    variants: HashMap<i64, Row>,
    modifiers: HashMap<i64, Row>,
    taxes: HashMap<i64, Row>,
}

async fn catalogue(state: &AppState, lines: &[Value]) -> AppResult<Catalogue> {
    let mut product_ids = Vec::new();
    let mut variant_ids = Vec::new();
    let mut modifier_ids = Vec::new();
    for l in lines {
        if php::empty(l.get("food_item_id")) {
            product_ids.extend(l.get("id").and_then(fk_id));
        } else {
            product_ids.extend(l.get("food_item_id").and_then(fk_id));
            variant_ids.extend(l.get("id").and_then(fk_id));
        }
        if let Some(Value::Array(ms)) = l.get("modifiers") {
            modifier_ids.extend(ms.iter().filter_map(|m| m.get("id").and_then(fk_id)));
        }
    }
    Ok(Catalogue {
        products: common::by_ids(&state.db, "food_items", product_ids).await?,
        variants: common::by_ids(&state.db, "food_item_attributes", variant_ids).await?,
        modifiers: common::by_ids(&state.db, "modifiers", modifier_ids).await?,
        taxes: Sql::new("SELECT * FROM taxes").fetch_all(&state.db).await?.into_iter().map(|r| (r.i64("id"), r)).collect(),
    })
}

/// Rebuild one cart line from the catalogue. None when the line is not valid.
fn price_line(state: &AppState, s: &Settings, cat: &Catalogue, l: &Value, idx: usize, item_based: bool, ready: bool) -> Option<Value> {
    let o = l.as_object()?;
    let qty = whole(o.get("qty"), 1, MAX_QTY)?;
    let (product, variant) = if php::empty(o.get("food_item_id")) {
        (cat.products.get(&fk_id(o.get("id")?)?)?, None)
    } else {
        let v = cat.variants.get(&fk_id(o.get("id")?)?)?;
        let p = cat.products.get(&fk_id(o.get("food_item_id")?)?)?;
        if v.i64("food_item_id") != p.i64("id") {
            return None;
        }
        (p, Some(v))
    };
    if s.modes().allow_expiry_date {
        if let Some(exp) = product.opt_str("expiry_date").filter(|e| !e.is_empty() && e != "null") {
            let today = s.now().date();
            match crate::datefmt::parse(&exp) {
                Some(d) if d.date() >= today => {}
                _ => return None,
            }
        }
    }
    let source = variant.unwrap_or(product);
    let price = source.f64("price");
    let name = match variant {
        Some(v) => format!("{} ({})", product.str("name"), v.str("name")),
        None => product.str("name"),
    };
    let image = match product.opt_str("image").filter(|i| !i.is_empty()) {
        Some(i) => state.storage_url(&i),
        None => state.asset_url("images/default/product.png"),
    };
    let tax_row = match product.opt_i64("tax_id").filter(|t| *t != 0) {
        Some(id) => cat.taxes.get(&id),
        None => s.row.opt_i64("tax_id").and_then(|id| cat.taxes.get(&id)),
    };
    let tax_setup = tax_row.map(|t| common::tax_resource(s, t)).unwrap_or_else(|| order_tax(s));

    // Only the product's own (category) modifiers can be picked.
    let mut modifiers = Vec::new();
    let (mut mod_price, mut mod_cost) = (0.0, 0.0);
    match o.get("modifiers") {
        None | Some(Value::Null) => {}
        Some(Value::Array(list)) if list.len() <= 50 => {
            for m in list {
                let mo = m.as_object()?;
                let row = cat.modifiers.get(&fk_id(mo.get("id")?)?)?;
                if row.opt_i64("food_category_id") != product.opt_i64("food_category_id") {
                    return None;
                }
                let mqty = whole(mo.get("qty"), 1, MAX_MODIFIER_QTY)?;
                let checked = mo.get("is_checked").map(php::filter_bool).unwrap_or(false);
                if checked {
                    mod_price += mqty as f64 * row.f64("price");
                    mod_cost += mqty as f64 * row.f64("cost");
                }
                modifiers.push(json!({
                    "id": row.val("id"),
                    "title": row.val("title"),
                    "price": row.val("price"),
                    "cost": row.val("cost"),
                    "qty": mqty,
                    "is_checked": checked,
                }));
            }
        }
        _ => return None,
    }

    let base = qty as f64 * price + mod_price;
    let cart_uuid = clip(o.get("cart_uuid"), 100).unwrap_or_else(|| format!("{}{}{}", source.i64("id"), source.str("uuid"), idx));
    let mut line = Map::new();
    line.insert("cart_uuid".into(), Value::from(cart_uuid));
    line.insert("uuid".into(), source.val("uuid"));
    line.insert("id".into(), source.val("id"));
    line.insert("food_item_id".into(), if variant.is_some() { product.val("id") } else { Value::Null });
    line.insert("name".into(), Value::from(name));
    line.insert("image".into(), Value::from(image));
    line.insert("price".into(), source.val("price"));
    line.insert("cost".into(), source.val("cost"));
    line.insert("in_stock".into(), Value::from(200));
    line.insert("qty".into(), Value::from(qty));
    line.insert("sub_total".into(), crate::util::json_num(base));
    line.insert("modifiers".into(), Value::Array(modifiers));
    line.insert("modifiers_price".into(), crate::util::json_num(mod_price));
    line.insert("modifiers_cost".into(), crate::util::json_num(mod_cost));
    line.insert("is_ready".into(), Value::Bool(ready));
    line.insert("is_bar_type".into(), common::bool_col(product, "is_bar_type"));
    line.insert("tax_id".into(), tax_setup.get("id").cloned().unwrap_or(Value::Null));
    line.insert("tax_setup".into(), tax_setup.clone());
    line.insert("tax_amount".into(), Value::from(0));
    if let Some(note) = clip(o.get("note"), 500) {
        line.insert("note".into(), Value::from(note.trim()));
    }
    if item_based {
        let rule = TaxRule::from_json(&tax_setup);
        let tax = rule.tax_for(base);
        line.insert("tax_amount".into(), Value::from(format!("{tax:.2}")));
        if rule.included {
            line.insert("sub_total_before_tax".into(), crate::util::json_num(base - tax));
        } else {
            line.insert("sub_total_before_tax".into(), crate::util::json_num(base));
            line.insert("sub_total".into(), crate::util::json_num(base + tax));
        }
    }
    Some(Value::Object(line))
}

async fn collect_order(State(state): State<AppState>, input: Input) -> AppResult<Json<Value>> {
    let s = state.settings.get().await;
    let modes = s.modes();
    if !modes.digital_menu {
        return Err(AppError::forbidden("Digital menu is disabled"));
    }

    let mut errors = Errors::default();
    if missing(&input, "order_type") {
        errors.add("order_type", "The order type field is required.");
    } else if input.str("order_type").as_deref() != Some("dining") {
        errors.add("order_type", "The selected order type is invalid.");
    }
    match input.get("name") {
        None => errors.add("name", "The name field is required."),
        Some(Value::String(n)) if n.chars().count() > 191 => errors.add("name", "The name must not be greater than 191 characters."),
        Some(Value::String(_)) => {}
        Some(_) => errors.add("name", "The name must be a string."),
    }
    let email = input.opt_str("email");
    if let Some(e) = &email {
        if !valid_email(e) || e.len() > 191 {
            errors.add("email", "The email must be a valid email address.");
        }
    }
    let phone = input.opt_str("phone");
    if phone.as_ref().map(|p| p.chars().count() > 50).unwrap_or(false) {
        errors.add("phone", "The phone must not be greater than 50 characters.");
    }
    let lines = match input.get("items") {
        None => {
            errors.add("items", "The items field is required.");
            vec![]
        }
        Some(Value::Array(a)) if a.is_empty() => {
            errors.add("items", "The items field is required.");
            vec![]
        }
        Some(Value::Array(a)) if a.len() > MAX_LINES => {
            errors.add("items", format!("The items must not have more than {MAX_LINES} items."));
            vec![]
        }
        Some(Value::Array(a)) => a.clone(),
        Some(_) => {
            errors.add("items", "The items must be an array");
            vec![]
        }
    };
    let table_id = input.get("table_id").cloned();
    match &table_id {
        None if !modes.table_is_option => errors.add("table_id", "Service table is required for dinning order"),
        None => {}
        Some(v) => {
            let found = match fk_id(v) {
                Some(id) => common::by_ids(&state.db, "service_tables", [id]).await?.contains_key(&id),
                None => false,
            };
            if !found {
                errors.add("table_id", "No table was found");
            }
        }
    }
    errors.check()?;

    // Price every line from the catalogue.
    let cat = catalogue(&state, &lines).await?;
    let ready = modes.bypass_kitchen_bar;
    let mut priced = Vec::with_capacity(lines.len());
    for (i, l) in lines.iter().enumerate() {
        match price_line(&state, &s, &cat, l, i, modes.item_based_tax, ready) {
            Some(p) => priced.push(p),
            None => return Err(AppError::field("items", "The selected items are invalid.")),
        }
    }
    let tax = order_tax(&s);
    let t = totals(&priced, modes.item_based_tax, &TaxRule::from_json(&tax));

    let now = s.now();
    let uuid = crate::util::uuid();
    let name = input.string("name");
    let note = clip(input.get("note_for_chef"), 1000);
    let table = table_id.as_ref().and_then(fk_id);

    let mut tx = state.db.begin().await?;
    // Reuse a customer only on a real e-mail / phone match.
    let mut customer: Option<i64> = None;
    if email.is_some() || phone.is_some() {
        let mut q = Sql::new("SELECT id FROM customers WHERE 1=0");
        if let Some(e) = &email {
            q.push_args(" OR email = ?", [e.clone()]);
        }
        if let Some(p) = &phone {
            q.push_args(" OR phone = ?", [p.clone()]);
        }
        q.push(" ORDER BY id LIMIT 1");
        customer = common::tx_row(&mut tx, &q.text, q.args.clone()).await?.map(|r| r.i64("id"));
    }
    let customer = match customer {
        Some(c) => c,
        None => tx_exec(
            &mut tx,
            "INSERT INTO customers (uuid, name, email, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            vec![crate::util::uuid().into(), name.clone().into(), email.clone().into(), phone.clone().into(), now.into(), now.into()],
        )
        .await?
        .last_insert_id() as i64,
    };
    let taker = match tx_row(&mut tx, "SELECT id FROM users WHERE id = 1", vec![]).await? {
        Some(_) => 1,
        None => tx_row(&mut tx, "SELECT id FROM users ORDER BY role_id, id LIMIT 1", vec![]).await?.map(|r| r.i64("id")).unwrap_or(1),
    };

    let mut data = SaleData::default();
    let n = crate::util::json_num;
    data.set("order_type", Value::from("dining"));
    data.set("cart_total_cost", n(money(t.cost)));
    data.set("cart_total_items", n(t.items));
    data.set("cart_total_price", n(money(t.net)));
    data.set("profit_after_all", n(money(t.profit)));
    data.set("items", Value::Array(priced.clone()));
    data.set("tax", tax);
    data.set("tax_amount", n(money(t.tax)));
    data.set("progress", Value::from(t.progress));
    data.set("note_for_chef", note.map(Value::from).unwrap_or(Value::Null));
    data.set("discount_amount", Value::from(0));
    data.set("discount_rate", Value::from(0));
    data.set("is_discount_in_percentage", Value::Bool(false));
    data.set("payable_after_all", n(money(t.total)));
    data.set("is_item_based_taxation", Value::Bool(modes.item_based_tax));
    data.set("table_id", table.map(Value::from).unwrap_or(Value::Null));
    data.set("order_taker_id", Value::from(taker));
    data.set("took_at", Value::from(now.format("%Y-%m-%d %H:%M:%S").to_string()));
    data.set("uuid", Value::from(uuid.clone()));
    data.set("customer_id", Value::from(customer));
    if modes.cashbooks {
        let register = tx_row(&mut tx, "SELECT id FROM cash_books WHERE closed = 0 ORDER BY created_at DESC, id DESC LIMIT 1", vec![]).await?;
        data.set("cash_book_id", register.map(|r| Value::from(r.i64("id"))).unwrap_or(Value::Null));
    }
    let cols = data.columns(&mut tx).await?;
    let (id, tracking) = common::insert_sale(&mut tx, cols, &uuid, now).await?;
    common::create_sale_items(&state, &mut tx, id, &priced, now).await?;
    set_table_booked(&mut tx, table, true, now).await?;
    tx.commit().await?;
    notify::order_event(&state, id, OrderEvent::Created);
    Ok(common::reply(json!({ "message": state.t("Order placed successfully").await, "order": tracking })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tax_rules_like_the_till() {
        let pct = TaxRule { rate: 15.0, ..Default::default() };
        assert_eq!(pct.tax_for(100.0), 15.0);
        let fixed = TaxRule { rate: 5.0, fixed: true, ..Default::default() };
        assert_eq!(fixed.tax_for(100.0), 5.0);
        let vat_in = TaxRule { rate: 20.0, vat: true, included: true, ..Default::default() };
        assert_eq!(vat_in.tax_for(120.0), 20.0);
        let vat_out = TaxRule { rate: 20.0, vat: true, ..Default::default() };
        assert_eq!(vat_out.tax_for(100.0), 20.0);
        assert_eq!(TaxRule { rate: 10.0, ..Default::default() }.tax_for(13.95), 1.4);
        assert_eq!(to_fixed2(1.005), 1.0);
        assert_eq!(to_fixed2(0.125), 0.13);
    }

    #[test]
    fn totals_with_order_tax() {
        let lines = vec![
            json!({"qty": 1, "cost": 4, "sub_total": 12, "modifiers_cost": 1, "is_ready": true}),
            json!({"qty": 1, "cost": "1", "sub_total": 3.5, "modifiers_cost": 0, "is_ready": false}),
        ];
        let t = totals(&lines, false, &TaxRule { rate: 10.0, ..Default::default() });
        assert_eq!(t.items, 2.0);
        assert_eq!(t.price, 15.5);
        assert_eq!(t.cost, 6.0);
        assert_eq!(t.tax, 1.55);
        assert!((t.total - 17.05).abs() < 1e-9);
        assert_eq!(t.progress, 50);
        let inc = totals(&lines, false, &TaxRule { rate: 20.0, vat: true, included: true, ..Default::default() });
        assert_eq!(inc.total, 15.5);
        assert!((inc.net - (15.5 - inc.tax)).abs() < 1e-9);
    }
}
