//! Shared pieces of the order screens: JSON shapes of the records an order
//! refers to (customers, tables, staff, taxes...), loaded in batches, plus the
//! order-writing helpers used by the POS, the sales screen and the digital menu.

use super::php;
use crate::{
    db::{row_json, rows_json, Db, RowExt},
    error::{AppError, AppResult, Errors},
    query::{bind_all, Arg, Sql},
    settings::{Modes, Settings},
    state::AppState,
};
use chrono::NaiveDateTime;
use rust_decimal::{prelude::ToPrimitive, Decimal, RoundingStrategy};
use serde_json::{json, Map, Value};
use sqlx::MySqlConnection;
use std::collections::HashMap;

pub type Row = Map<String, Value>;

/* ------------------------------------------------------------------ db */

pub async fn tx_rows(conn: &mut MySqlConnection, sql: &str, args: Vec<Arg>) -> AppResult<Vec<Row>> {
    let rows = bind_all(sqlx::query(sql), &args).fetch_all(&mut *conn).await?;
    Ok(rows_json(&rows))
}

pub async fn tx_row(conn: &mut MySqlConnection, sql: &str, args: Vec<Arg>) -> AppResult<Option<Row>> {
    let row = bind_all(sqlx::query(sql), &args).fetch_optional(&mut *conn).await?;
    Ok(row.as_ref().map(row_json))
}

pub async fn tx_exec(conn: &mut MySqlConnection, sql: &str, args: Vec<Arg>) -> AppResult<sqlx::mysql::MySqlQueryResult> {
    Ok(bind_all(sqlx::query(sql), &args).execute(&mut *conn).await?)
}

/// Rows of `table` (a name from code) keyed by id.
pub async fn by_ids(db: &Db, table: &'static str, ids: impl IntoIterator<Item = i64>) -> AppResult<HashMap<i64, Row>> {
    let mut ids: Vec<i64> = ids.into_iter().collect();
    ids.sort_unstable();
    ids.dedup();
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let mut q = Sql::new(format!("SELECT * FROM {table} WHERE 1=1"));
    q.and_in("id", ids);
    Ok(q.fetch_all(db).await?.into_iter().map(|r| (r.i64("id"), r)).collect())
}

pub fn ids_of(rows: &[Row], key: &str) -> Vec<i64> {
    rows.iter().filter_map(|r| r.opt_i64(key)).collect()
}

/// Decoded JSON column (null when empty or invalid, like a `json` cast).
pub fn json_col(row: &Row, key: &str) -> Value {
    match row.get(key) {
        Some(Value::String(s)) => serde_json::from_str(s).unwrap_or(Value::Null),
        Some(Value::Null) | None => Value::Null,
        Some(other) => other.clone(),
    }
}

pub fn bool_col(row: &Row, key: &str) -> Value {
    match row.get(key) {
        Some(Value::Null) | None => Value::Null,
        Some(v) => Value::Bool(crate::util::truthy(v)),
    }
}

/// Stored date formatted with the app date format.
pub fn d(s: &Settings, row: &Row, key: &str) -> Value {
    s.fmt_value(&row.val(key))
}

/// A whole record the way `Model::toArray()` serialized it: timestamps as
/// ISO strings and the listed tinyint columns as booleans.
pub fn model_array(s: &Settings, row: &Row, bools: &[&str], dates: &[&str], hidden: &[&str]) -> Value {
    let mut m = Map::new();
    for (k, v) in row {
        if hidden.contains(&k.as_str()) {
            continue;
        }
        let v = if bools.contains(&k.as_str()) {
            bool_col(row, k)
        } else if k == "created_at" || k == "updated_at" || dates.contains(&k.as_str()) {
            s.iso_value(v)
        } else {
            v.clone()
        };
        m.insert(k.clone(), v);
    }
    Value::Object(m)
}

/* ----------------------------------------------------------- resources */

pub fn pos_table(row: &Row) -> Value {
    json!({ "id": row.val("id"), "title": row.val("title"), "is_booked": bool_col(row, "is_booked") })
}

/// A table in the till's picker and on the digital menu: the POS fields plus
/// whether it is open for ordering. Never the PIN or its counters.
pub fn listed_table(row: &Row, is_open: bool) -> Value {
    let mut v = pos_table(row);
    v["is_open"] = Value::Bool(is_open);
    v
}

pub fn opt_pos_table(row: Option<&Row>) -> Value {
    row.map(pos_table).unwrap_or(Value::Null)
}

/// ServiceTableResource (with the digital menu link).
pub fn full_table(state: &AppState, s: &Settings, row: &Row) -> Value {
    let stamp = chrono::Utc::now().timestamp();
    json!({
        "id": row.val("id"),
        "title": row.val("title"),
        "digital_menu": format!("{}/dm?t={}&stamp={}", state.cfg.app_url, row.i64("id"), stamp),
        "created_at": d(s, row, "created_at"),
        "updated_at": d(s, row, "updated_at"),
    })
}

pub fn pos_pickup(s: &Settings, row: &Row) -> Value {
    json!({
        "id": row.val("id"),
        "place_title": row.val("place_title"),
        "person_name": row.val("person_name"),
        "phone": row.val("phone"),
        "address": row.val("address"),
        "created_at": d(s, row, "created_at"),
        "updated_at": d(s, row, "updated_at"),
    })
}

pub fn opt_pos_pickup(s: &Settings, row: Option<&Row>) -> Value {
    row.map(|r| pos_pickup(s, r)).unwrap_or(Value::Null)
}

fn shipping_addresses(row: &Row) -> Value {
    match json_col(row, "shipping_addresses") {
        Value::Null => json!([]),
        v => v,
    }
}

/// CustomerResource
pub fn customer_basic(s: &Settings, row: &Row) -> Value {
    json!({
        "id": row.val("id"),
        "uuid": row.val("uuid"),
        "name": row.val("name"),
        "email": row.val("email"),
        "phone": row.val("phone"),
        "address": row.val("address"),
        "shipping_addresses": shipping_addresses(row),
        "created_at": d(s, row, "created_at"),
        "updated_at": d(s, row, "updated_at"),
    })
}

/// PosCustomerResource (with the last ten orders as history).
pub fn pos_customer(s: &Settings, row: &Row, history: &[Row], now: &NaiveDateTime) -> Value {
    let full = format!("{} {} {}", row.str("name"), row.str("email"), row.str("phone"));
    let history: Vec<Value> = history
        .iter()
        .map(|h| {
            let when = h
                .opt_str("updated_at")
                .and_then(|u| crate::datefmt::parse(&u))
                .map(|u| Value::from(php::diff_for_humans(&u, now)))
                .unwrap_or(Value::Null);
            json!({
                "id": h.val("id"),
                "uuid": h.val("uuid"),
                "tracking": h.val("tracking"),
                "created_at": when,
                "updated_at": d(s, h, "updated_at"),
            })
        })
        .collect();
    json!({
        "id": row.val("id"),
        "uuid": row.val("uuid"),
        "full_name": php::trim(&full),
        "name": row.val("name"),
        "email": row.val("email"),
        "address": row.val("address"),
        "phone": row.val("phone"),
        "shipping_addresses": shipping_addresses(row),
        "history": history,
        "created_at": d(s, row, "created_at"),
        "updated_at": d(s, row, "updated_at"),
    })
}

/// PosCustomerResource for each customer id.
pub async fn load_pos_customers(state: &AppState, ids: impl IntoIterator<Item = i64>) -> AppResult<HashMap<i64, Value>> {
    let customers = by_ids(&state.db, "customers", ids).await?;
    if customers.is_empty() {
        return Ok(HashMap::new());
    }
    let s = state.settings.get().await;
    let now = s.now();
    let mut q = Sql::new(
        "SELECT id, uuid, tracking, customer_id, updated_at FROM (SELECT id, uuid, tracking, customer_id, created_at, updated_at, \
         ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY created_at DESC, id ASC) AS rn FROM sales WHERE 1=1",
    );
    q.and_in("customer_id", customers.keys().copied());
    q.push(") ranked WHERE rn <= 10 ORDER BY customer_id, rn");
    let mut history: HashMap<i64, Vec<Row>> = HashMap::new();
    for h in q.fetch_all(&state.db).await? {
        history.entry(h.i64("customer_id")).or_default().push(h);
    }
    Ok(customers.iter().map(|(id, row)| (*id, pos_customer(&s, row, history.get(id).map(Vec::as_slice).unwrap_or(&[]), &now))).collect())
}

/// TaxResource
pub fn tax_resource(s: &Settings, row: &Row) -> Value {
    json!({
        "id": row.val("id"),
        "tax_title": row.val("tax_title"),
        "tax_rate": row.val("tax_rate"),
        "is_vat": bool_col(row, "is_vat"),
        "is_tax_fix": bool_col(row, "is_tax_fix"),
        "tax_id": row.val("tax_id"),
        "is_tax_included": bool_col(row, "is_tax_included"),
        "created_at": d(s, row, "created_at"),
        "updated_at": d(s, row, "updated_at"),
    })
}

/// PosTaxResource
pub fn pos_tax(s: &Settings, row: &Row) -> Value {
    json!({
        "id": row.val("id"),
        "tax_title": row.val("tax_title"),
        "tax_rate": row.val("tax_rate"),
        "is_vat": bool_col(row, "is_vat"),
        "is_tax_fix": bool_col(row, "is_tax_fix"),
        "is_tax_included": bool_col(row, "is_tax_included"),
        "created_at": d(s, row, "created_at"),
        "updated_at": d(s, row, "updated_at"),
    })
}

/// PosModifierResource. The public menu does not get the cost price.
pub fn pos_modifier(s: &Settings, row: &Row, public: bool) -> Value {
    json!({
        "id": row.val("id"),
        "title": row.val("title"),
        "price": row.val("price"),
        "cost": if public { Value::Null } else { row.val("cost") },
        "qty": 1,
        "created_at": d(s, row, "created_at"),
        "updated_at": d(s, row, "updated_at"),
    })
}

pub fn pos_payment_method(row: &Row) -> Value {
    json!({ "id": row.val("id"), "title": row.val("title") })
}

/// PaymentMethodResource
pub fn payment_method(s: &Settings, row: &Row) -> Value {
    json!({
        "id": row.val("id"),
        "title": row.val("title"),
        "created_at": d(s, row, "created_at"),
        "updated_at": d(s, row, "updated_at"),
    })
}

/// PosStaffResource for each user id (with the role and its user count).
pub async fn load_staff(state: &AppState, ids: impl IntoIterator<Item = i64>) -> AppResult<HashMap<i64, Value>> {
    let users = by_ids(&state.db, "users", ids).await?;
    staff_from_rows(state, users.into_values().collect()).await
}

pub async fn staff_from_rows(state: &AppState, users: Vec<Row>) -> AppResult<HashMap<i64, Value>> {
    if users.is_empty() {
        return Ok(HashMap::new());
    }
    let s = state.settings.get().await;
    let roles = by_ids(&state.db, "user_roles", ids_of(&users, "role_id")).await?;
    let mut counts: HashMap<i64, i64> = HashMap::new();
    if !roles.is_empty() {
        let mut q = Sql::new("SELECT role_id, COUNT(*) AS c FROM users WHERE 1=1");
        q.and_in("role_id", roles.keys().copied());
        q.push(" GROUP BY role_id");
        for r in q.fetch_all(&state.db).await? {
            counts.insert(r.i64("role_id"), r.i64("c"));
        }
    }
    let mut out = HashMap::new();
    for u in users {
        let role = u.opt_i64("role_id").and_then(|id| roles.get(&id)).map(|r| {
            json!({
                "id": r.val("id"),
                "name": r.val("name"),
                "is_primary": bool_col(r, "is_primary"),
                "users": counts.get(&r.i64("id")).copied().unwrap_or(0),
                "permissions": json_col(r, "permissions"),
                "admin_access": null,
                "ordertaking_access": null,
                "kitchendisplay_access": null,
                "billingdisplay_access": null,
                "created_at": d(&s, r, "created_at"),
                "updated_at": d(&s, r, "updated_at"),
            })
        });
        let avatar = match u.opt_str("avatar").filter(|a| !a.is_empty()) {
            Some(a) => state.storage_url(&a),
            None => "gravatar".into(),
        };
        let email = u.str("email");
        let gravatar =
            format!("https://www.gravatar.com/avatar/{}?s=80&d=retro", php::md5_hex(php::trim(&email).to_lowercase().as_bytes()));
        out.insert(
            u.i64("id"),
            json!({
                "id": u.val("id"),
                "name": u.val("name"),
                "email": u.val("email"),
                "phone": u.val("phone"),
                "avatar": avatar,
                "gravatar": gravatar,
                "role": role.unwrap_or(Value::Null),
                "created_at": d(&s, &u, "created_at"),
                "updated_at": d(&s, &u, "updated_at"),
            }),
        );
    }
    Ok(out)
}

/// Active users of a role (2 order takers, 3 chefs, 4 billers), by id.
pub async fn users_of_role(db: &Db, role: i64) -> AppResult<Vec<Row>> {
    let mut q = Sql::new("SELECT * FROM users WHERE role_id = ?");
    q.args.push(role.into());
    q.push(" AND status = 1 ORDER BY id");
    q.fetch_all(db).await
}

/// GuestRoomResource for each room id (with every reservation's time slot).
async fn load_rooms(state: &AppState, s: &Settings, ids: Vec<i64>) -> AppResult<HashMap<i64, Value>> {
    let rooms = by_ids(&state.db, "guest_rooms", ids).await?;
    let mut slots: HashMap<i64, Vec<Value>> = HashMap::new();
    if !rooms.is_empty() {
        let mut q = Sql::new(
            "SELECT guest_room_id, reserved_at_date, reserved_at_time, reserved_till_date, reserved_till_time FROM guest_room_reservations WHERE 1=1",
        );
        q.and_in("guest_room_id", rooms.keys().copied());
        q.push(" ORDER BY id");
        for r in q.fetch_all(&state.db).await? {
            slots.entry(r.i64("guest_room_id")).or_default().push(json!({
                "reserved_at_date": r.val("reserved_at_date"),
                "reserved_at_time": r.val("reserved_at_time"),
                "reserved_till_date": r.val("reserved_till_date"),
                "reserved_till_time": r.val("reserved_till_time"),
            }));
        }
    }
    Ok(rooms
        .iter()
        .map(|(id, r)| {
            (
                *id,
                json!({
                    "id": r.val("id"),
                    "room_name": r.val("room_name"),
                    "capactity": r.val("capactity"),
                    "per_hour_charges": r.val("per_hour_charges"),
                    "per_use_charges": r.val("per_use_charges"),
                    "layout": r.val("layout"),
                    "reserved_slots": slots.remove(id).unwrap_or_default(),
                    "created_at": d(s, r, "created_at"),
                    "updated_at": d(s, r, "updated_at"),
                }),
            )
        })
        .collect())
}

/// Order totals of a reservation's room-service sales.
pub struct ReservationSales {
    pub rows: Vec<Row>,
}

impl ReservationSales {
    fn sum(&self, key: &str) -> Value {
        crate::util::json_num(self.rows.iter().map(|r| php::to_float(r.get(key))).sum())
    }
}

/// Everything the reservation resources need, loaded in batches.
pub struct ReservationParts {
    pub customers: HashMap<i64, Row>,
    pub rooms: HashMap<i64, Value>,
    pub sales: HashMap<i64, ReservationSales>,
}

pub async fn reservation_parts(state: &AppState, s: &Settings, rows: &[Row]) -> AppResult<ReservationParts> {
    let customers = by_ids(&state.db, "customers", ids_of(rows, "customer_id")).await?;
    let rooms = load_rooms(state, s, ids_of(rows, "guest_room_id")).await?;
    let mut sales: HashMap<i64, ReservationSales> = HashMap::new();
    let ids = ids_of(rows, "id");
    if !ids.is_empty() {
        let mut q = Sql::new("SELECT * FROM sales WHERE 1=1");
        q.and_in("guest_room_reservation_id", ids);
        q.push(" ORDER BY id");
        for r in q.fetch_all(&state.db).await? {
            sales.entry(r.i64("guest_room_reservation_id")).or_insert_with(|| ReservationSales { rows: vec![] }).rows.push(r);
        }
    }
    Ok(ReservationParts { customers, rooms, sales })
}

/// The sums and counts the reservation resources share.
pub fn reservation_sales_fields(parts: &ReservationParts, id: i64) -> [(&'static str, Value); 5] {
    let empty = ReservationSales { rows: vec![] };
    let sales = parts.sales.get(&id).unwrap_or(&empty);
    [
        ("sales_tax_amount", sales.sum("tax_amount")),
        ("sale_discount_amount", sales.sum("discount_amount")),
        ("sales_payable_amount", sales.sum("payable_after_all")),
        ("sales_items", sales.sum("cart_total_items")),
        ("sales_orders", Value::from(sales.rows.len())),
    ]
}

/// PosGuestRoomReservationResource
pub fn pos_reservation(s: &Settings, parts: &ReservationParts, r: &Row) -> Value {
    let mut m = Map::new();
    m.insert("id".into(), r.val("id"));
    m.insert("uuid".into(), r.val("uuid"));
    m.insert("tracking".into(), r.val("tracking"));
    m.insert(
        "customer".into(),
        r.opt_i64("customer_id").and_then(|c| parts.customers.get(&c)).map(|c| customer_basic(s, c)).unwrap_or(Value::Null),
    );
    m.insert("guest_room".into(), r.opt_i64("guest_room_id").and_then(|g| parts.rooms.get(&g)).cloned().unwrap_or(Value::Null));
    m.insert("checkin_at".into(), r.val("checkin_at"));
    m.insert("checkout_at".into(), r.val("checkout_at"));
    m.insert("payment_cleared".into(), bool_col(r, "payment_cleared"));
    m.insert(
        "payments".into(),
        match json_col(r, "payments") {
            Value::Null => json!([]),
            v => v,
        },
    );
    m.insert("note".into(), r.val("note"));
    m.insert("staff_note".into(), r.val("staff_note"));
    m.insert("tax_amount".into(), r.val("tax_amount"));
    m.insert("tax".into(), json_col(r, "tax"));
    for (k, v) in reservation_sales_fields(parts, r.i64("id")) {
        m.insert(k.into(), v);
    }
    m.insert("total_room_service_charges".into(), r.val("total_room_service_charges"));
    m.insert("reservation_hours".into(), r.val("reservation_hours"));
    m.insert("sub_total".into(), r.val("sub_total"));
    m.insert("is_charge_per_use".into(), bool_col(r, "is_charge_per_use"));
    // the previous release showed the update time as the creation time here
    m.insert("created_at".into(), d(s, r, "updated_at"));
    m.insert("updated_at".into(), d(s, r, "updated_at"));
    Value::Object(m)
}

/// Checked-in reservations (POS room service list).
pub async fn checked_in_reservations(state: &AppState) -> AppResult<Vec<Value>> {
    let rows = Sql::new("SELECT * FROM guest_room_reservations WHERE checkin_at IS NOT NULL AND checkout_at IS NULL ORDER BY id")
        .fetch_all(&state.db)
        .await?;
    let s = state.settings.get().await;
    let parts = reservation_parts(state, &s, &rows).await?;
    Ok(rows.iter().map(|r| pos_reservation(&s, &parts, r)).collect())
}

/* -------------------------------------------------------------- orders */

pub const ORDER_TYPES: [&str; 4] = ["dining", "pickup", "dilivery", "roomservice"];

pub async fn sale_by_uuid(db: &Db, uuid: &str) -> AppResult<Row> {
    let mut q = Sql::new("SELECT * FROM sales WHERE uuid = ?");
    q.args.push(uuid.into());
    q.fetch_optional(db).await?.ok_or_else(AppError::not_found)
}

/// The sale row, locked until the transaction ends.
pub async fn lock_sale(conn: &mut MySqlConnection, id: i64) -> AppResult<Row> {
    tx_row(conn, "SELECT * FROM sales WHERE id = ? FOR UPDATE", vec![id.into()]).await?.ok_or_else(AppError::not_found)
}

/// Mark a table free / taken.
pub async fn set_table_booked(conn: &mut MySqlConnection, table_id: Option<i64>, booked: bool, now: NaiveDateTime) -> AppResult<()> {
    if let Some(id) = table_id {
        tx_exec(conn, "UPDATE service_tables SET is_booked = ?, updated_at = ? WHERE id = ?", vec![booked.into(), now.into(), id.into()])
            .await?;
    }
    Ok(())
}

/// A table already serving another order cannot take a new one, unless
/// tables can be reselected or are optional. Locks the table row.
pub async fn table_is_serving(conn: &mut MySqlConnection, modes: &Modes, table_id: Option<i64>) -> AppResult<bool> {
    if modes.allow_table_reselect || modes.table_is_option {
        return Ok(false);
    }
    let Some(id) = table_id else { return Ok(false) };
    let row = tx_row(conn, "SELECT is_booked FROM service_tables WHERE id = ? FOR UPDATE", vec![id.into()]).await?;
    Ok(row.map(|r| r.bool("is_booked")).unwrap_or(false))
}

/// Tracking number: YYYYMM000 plus the sale id (unique by construction).
pub fn tracking_for(now: &NaiveDateTime, id: i64) -> String {
    let base: i64 = now.format("%Y%m000").to_string().parse().unwrap_or(0);
    (base + id).to_string()
}

/// How a `sales` column is written.
#[derive(Clone, Copy)]
enum Kind {
    Json,
    Bool,
    /// double(8,2)
    Money,
    /// varchar holding a number
    NumText,
    Int,
    Fk(&'static str),
    Time,
    Text(usize),
}

/// The writable (`$fillable`) columns of `sales`.
const SALE_COLUMNS: [(&str, Kind); 37] = [
    ("tracking", Kind::Text(191)),
    ("uuid", Kind::Text(191)),
    ("took_at", Kind::Time),
    ("order_taker_id", Kind::Fk("users")),
    ("order_type", Kind::Text(191)),
    ("cart_total_cost", Kind::Money),
    ("cart_total_items", Kind::NumText),
    ("cart_total_price", Kind::Money),
    ("items", Kind::Json),
    ("profit_after_all", Kind::Money),
    ("payable_after_all", Kind::Money),
    ("tax", Kind::Json),
    ("tax_amount", Kind::Money),
    ("discount_rate", Kind::Money),
    ("discount_amount", Kind::Money),
    ("table_id", Kind::Fk("service_tables")),
    ("is_preparing", Kind::Bool),
    ("chef_id", Kind::Fk("users")),
    ("prepared_at", Kind::Time),
    ("customer_id", Kind::Fk("customers")),
    ("ordered_online", Kind::Bool),
    ("biller_id", Kind::Fk("users")),
    ("completed_at", Kind::Time),
    ("payment_note", Kind::Text(65535)),
    ("progress", Kind::Int),
    ("staff_note", Kind::Text(65535)),
    ("payment_method_id", Kind::Fk("payment_methods")),
    ("note_for_chef", Kind::Text(65535)),
    ("is_cancelled", Kind::Bool),
    ("cancellation_reason", Kind::Text(65535)),
    ("is_discount_in_percentage", Kind::Bool),
    ("pickup_point_id", Kind::Fk("pickup_points")),
    ("shipping_address", Kind::Text(65535)),
    ("cash_book_id", Kind::Fk("cash_books")),
    ("tip_amount", Kind::Money),
    ("guest_room_reservation_id", Kind::Fk("guest_room_reservations")),
    ("is_item_based_taxation", Kind::Bool),
];

fn attr(key: &str) -> String {
    key.replace('_', " ")
}

pub fn fk_id(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().filter(|f| f.fract() == 0.0).map(|f| f as i64)),
        Value::String(s) => s.trim().parse::<i64>().ok(),
        _ => None,
    }
}

/// Order data being written: column -> value, in request order.
#[derive(Debug, Clone, Default)]
pub struct SaleData(pub Vec<(String, Value)>);

impl SaleData {
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }
    pub fn set(&mut self, key: &str, v: Value) {
        match self.0.iter_mut().find(|(k, _)| k == key) {
            Some(e) => e.1 = v,
            None => self.0.push((key.to_string(), v)),
        }
    }
    pub fn has(&self, key: &str) -> bool {
        self.0.iter().any(|(k, _)| k == key)
    }
    pub fn id(&self, key: &str) -> Option<i64> {
        self.get(key).and_then(fk_id)
    }

    /// Null out the destinations that do not belong to the order type.
    pub fn apply_order_type(&mut self) {
        let clear: &[&str] = match self.get("order_type").and_then(Value::as_str) {
            Some("dining") => &["pickup_point_id", "shipping_address"],
            Some("pickup") => &["table_id", "shipping_address"],
            Some("dilivery") => &["table_id", "pickup_point_id"],
            _ => &[],
        };
        for k in clear {
            self.set(k, Value::Null);
        }
    }

    /// Typed column values for the writable columns present, after checking
    /// numbers, dates and that referenced records exist.
    pub async fn columns(&self, conn: &mut MySqlConnection) -> AppResult<Vec<(&'static str, Arg)>> {
        let mut errors = Errors::default();
        let mut out = Vec::new();
        for (key, v) in &self.0 {
            let Some((col, kind)) = SALE_COLUMNS.iter().find(|(c, _)| c == key) else { continue };
            let arg: Arg = match kind {
                Kind::Json => {
                    if v.is_null() {
                        errors.add(key, format!("The {} field is required.", attr(key)));
                        continue;
                    }
                    Arg::Str(php::json_encode(v))
                }
                Kind::Bool => Arg::Int(crate::util::truthy(v) as i64),
                Kind::Money => match money_value(v) {
                    Some(f) if f.abs() <= 999_999.99 => Arg::Float(f),
                    Some(_) => {
                        errors.add(key, format!("The {} must be between -999999.99 and 999999.99.", attr(key)));
                        continue;
                    }
                    None => {
                        errors.add(key, format!("The {} must be a number.", attr(key)));
                        continue;
                    }
                },
                Kind::NumText => match v {
                    Value::Null => Arg::Str("0".into()),
                    other => match php::number_string(other) {
                        Some(s) => Arg::Str(s),
                        None => {
                            errors.add(key, format!("The {} must be a number.", attr(key)));
                            continue;
                        }
                    },
                },
                Kind::Int => match money_value(v) {
                    Some(f) if f.abs() < 2_147_483_647.0 => Arg::Int(crate::util::round(f, 0) as i64),
                    _ => {
                        errors.add(key, format!("The {} must be a number.", attr(key)));
                        continue;
                    }
                },
                Kind::Fk(table) => {
                    if v.is_null() {
                        Arg::Null
                    } else {
                        match fk_id(v) {
                            Some(id) if exists(conn, table, id).await? => Arg::Int(id),
                            _ => {
                                errors.add(key, format!("The selected {} is invalid.", attr(key)));
                                continue;
                            }
                        }
                    }
                }
                Kind::Time => match v {
                    Value::Null => Arg::Null,
                    Value::String(s) => match crate::datefmt::parse(s) {
                        Some(t) => Arg::Time(t),
                        None => {
                            errors.add(key, format!("The {} is not a valid date.", attr(key)));
                            continue;
                        }
                    },
                    _ => {
                        errors.add(key, format!("The {} is not a valid date.", attr(key)));
                        continue;
                    }
                },
                Kind::Text(max) => match v {
                    Value::Null => Arg::Null,
                    Value::String(s) if s.chars().count() <= *max => Arg::Str(s.clone()),
                    Value::String(_) => {
                        errors.add(key, format!("The {} must not be greater than {} characters.", attr(key), max));
                        continue;
                    }
                    Value::Number(_) | Value::Bool(_) => Arg::Str(match v {
                        Value::Bool(b) => (if *b { "1" } else { "" }).to_string(),
                        other => php::number_string(other).unwrap_or_default(),
                    }),
                    _ => {
                        errors.add(key, format!("The {} must be a string.", attr(key)));
                        continue;
                    }
                },
            };
            out.push((*col, arg));
        }
        errors.check()?;
        Ok(out)
    }
}

/// A money value: number or numeric string; null counts as 0.
fn money_value(v: &Value) -> Option<f64> {
    match v {
        Value::Null => Some(0.0),
        Value::Number(n) => n.as_f64().filter(|f| f.is_finite()),
        Value::String(s) => s.trim().parse::<f64>().ok().filter(|f| f.is_finite()),
        Value::Bool(b) => Some(*b as i64 as f64),
        _ => None,
    }
}

pub async fn exists(conn: &mut MySqlConnection, table: &'static str, id: i64) -> AppResult<bool> {
    let row = tx_row(conn, &format!("SELECT 1 AS x FROM {table} WHERE id = ?"), vec![id.into()]).await?;
    Ok(row.is_some())
}

/// Insert a sale and give it its tracking number. Returns (id, tracking).
pub async fn insert_sale(
    conn: &mut MySqlConnection,
    cols: Vec<(&'static str, Arg)>,
    uuid: &str,
    now: NaiveDateTime,
) -> AppResult<(i64, String)> {
    let mut names: Vec<&str> = vec!["tracking"];
    let mut args: Vec<Arg> = vec![Arg::Str(format!("pending-{uuid}"))];
    for (c, a) in cols {
        if c == "tracking" {
            continue;
        }
        names.push(c);
        args.push(a);
    }
    names.push("created_at");
    args.push(now.into());
    names.push("updated_at");
    args.push(now.into());
    let sql = format!(
        "INSERT INTO sales ({}) VALUES ({})",
        names.iter().map(|n| format!("`{n}`")).collect::<Vec<_>>().join(", "),
        vec!["?"; names.len()].join(", ")
    );
    let id = tx_exec(conn, &sql, args).await?.last_insert_id() as i64;
    let tracking = tracking_for(&now, id);
    tx_exec(conn, "UPDATE sales SET tracking = ?, updated_at = ? WHERE id = ?", vec![tracking.clone().into(), now.into(), id.into()])
        .await?;
    Ok((id, tracking))
}

pub async fn update_sale(conn: &mut MySqlConnection, id: i64, cols: Vec<(&'static str, Arg)>, now: NaiveDateTime) -> AppResult<()> {
    let mut sets: Vec<String> = Vec::new();
    let mut args: Vec<Arg> = Vec::new();
    for (c, a) in cols {
        sets.push(format!("`{c}` = ?"));
        args.push(a);
    }
    sets.push("updated_at = ?".into());
    args.push(now.into());
    args.push(id.into());
    tx_exec(conn, &format!("UPDATE sales SET {} WHERE id = ?", sets.join(", ")), args).await?;
    Ok(())
}

/// Cart lines as a list (a JSON string is decoded first).
pub fn items_list(v: Option<&Value>) -> Vec<Value> {
    match v {
        Some(Value::Array(a)) => a.clone(),
        Some(Value::Object(o)) => o.values().cloned().collect(),
        Some(Value::String(s)) => match serde_json::from_str::<Value>(s) {
            Ok(Value::Array(a)) => a,
            Ok(Value::Object(o)) => o.values().cloned().collect(),
            _ => vec![],
        },
        _ => vec![],
    }
}

/// Most cart lines one order may hold.
pub const MAX_LINES: usize = 500;

/// Write the `sale_items` rows of a sale (one per cart line), checking that
/// each product exists.
pub async fn create_sale_items(
    state: &AppState,
    conn: &mut MySqlConnection,
    sale_id: i64,
    items: &[Value],
    now: NaiveDateTime,
) -> AppResult<()> {
    if items.len() > MAX_LINES {
        return Err(AppError::field("items", format!("The items must not have more than {MAX_LINES} items.")));
    }
    let s = state.settings.get().await;
    let invalid = || AppError::field("items", "The selected items are invalid.");
    for item in items {
        let Some(obj) = item.as_object() else { return Err(invalid()) };
        let variant = !php::empty(obj.get("food_item_id"));
        let id = obj.get("id").and_then(fk_id).ok_or_else(invalid)?;
        let (product_id, attribute_id, data, category) = if variant {
            let pid = obj.get("food_item_id").and_then(fk_id).ok_or_else(invalid)?;
            let product = tx_row(conn, "SELECT * FROM food_items WHERE id = ?", vec![pid.into()]).await?.ok_or_else(invalid)?;
            let attribute = tx_row(conn, "SELECT * FROM food_item_attributes WHERE id = ?", vec![id.into()]).await?.ok_or_else(invalid)?;
            (pid, Some(id), model_array(&s, &attribute, &[], &[], &[]), product.val("food_category_id"))
        } else {
            let product = tx_row(conn, "SELECT * FROM food_items WHERE id = ?", vec![id.into()]).await?.ok_or_else(invalid)?;
            let data = model_array(&s, &product, &["is_bar_type", "has_variants"], &[], &[]);
            (id, None, data, product.val("food_category_id"))
        };
        let name = match obj.get("name") {
            Some(Value::String(n)) => n.chars().take(191).collect::<String>(),
            Some(v @ Value::Number(_)) => php::number_string(v).unwrap_or_default(),
            _ => return Err(AppError::field("items", "The item name field is required.")),
        };
        let qty = number(obj.get("qty")).filter(|q| *q > 0.0 && *q <= MAX_LINE_QTY).ok_or_else(invalid)?;
        let price = number(obj.get("price")).filter(|p| (0.0..1e8).contains(p)).ok_or_else(invalid)?;
        let total = number(obj.get("sub_total")).filter(|t| (0.0..1e8).contains(t)).ok_or_else(invalid)?;
        let total = crate::util::round(total, 2);
        let category = match category {
            Value::Null => Arg::Null,
            v => Arg::Str(php::number_string(&v).unwrap_or_default()),
        };
        tx_exec(
            conn,
            "INSERT INTO sale_items (sale_id, item_data, item_name, quantity, price, total_amount, food_item_id, food_item_attribute_id, food_category_id, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            vec![
                sale_id.into(),
                Arg::Str(php::json_encode(&data)),
                name.into(),
                Arg::Int(crate::util::round(qty, 0) as i64),
                Arg::Float(price),
                Arg::Float(total),
                product_id.into(),
                attribute_id.into(),
                category,
                now.into(),
                now.into(),
            ],
        )
        .await?;
    }
    Ok(())
}

/* -------------------------------------------------------------- pricing */

/// `Number(x.toFixed(2))`: two decimals from the exact binary value, ties away from zero.
pub fn to_fixed2(v: f64) -> f64 {
    Decimal::from_f64_retain(v)
        .map(|d| d.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero))
        .and_then(|d| d.to_f64())
        .unwrap_or(0.0)
}

/// Money rounding of stored totals (`Math.round((n + EPSILON) * 100) / 100`).
pub fn money(v: f64) -> f64 {
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
    pub fn from_json(v: &Value) -> Self {
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
pub fn order_tax(s: &Settings) -> Value {
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

pub struct Totals {
    pub items: f64,
    /// before discount and tax
    pub price: f64,
    pub cost: f64,
    pub discount: f64,
    pub net: f64,
    pub tax: f64,
    pub total: f64,
    pub profit: f64,
    pub progress: i64,
}

/// orderTotals() of the web app (the tip is not part of the total).
/// `discount` is the discount rate: a percentage when `percent`, else an amount.
pub fn totals(lines: &[Value], item_based: bool, tax: &TaxRule, discount: f64, percent: bool) -> Totals {
    let f = |l: &Value, k: &str| php::to_float(l.get(k));
    let items: f64 = lines.iter().map(|l| f(l, "qty")).sum();
    let price: f64 = lines.iter().map(|l| f(l, "sub_total")).sum();
    let cost: f64 = lines.iter().map(|l| f(l, "cost") * f(l, "qty") + f(l, "modifiers_cost")).sum();
    let discount = if percent { discount / 100.0 * price } else { discount };
    let after = price - discount;
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
    Totals { items, price, cost, discount, net, tax: tax_amount, total, profit: after - cost, progress }
}

/// Catalogue rows needed to price the requested lines.
pub struct Catalogue {
    pub products: HashMap<i64, Row>,
    pub variants: HashMap<i64, Row>,
    pub modifiers: HashMap<i64, Row>,
    pub taxes: HashMap<i64, Row>,
}

pub async fn catalogue(state: &AppState, lines: &[Value]) -> AppResult<Catalogue> {
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
        products: by_ids(&state.db, "food_items", product_ids).await?,
        variants: by_ids(&state.db, "food_item_attributes", variant_ids).await?,
        modifiers: by_ids(&state.db, "modifiers", modifier_ids).await?,
        taxes: Sql::new("SELECT * FROM taxes").fetch_all(&state.db).await?.into_iter().map(|r| (r.i64("id"), r)).collect(),
    })
}

/// A number sent as a JSON number or numeric text; None for anything else.
pub fn number(v: Option<&Value>) -> Option<f64> {
    let n = match v? {
        Value::Number(n) => n.as_f64()?,
        Value::String(s) => s.trim().parse::<f64>().ok()?,
        _ => return None,
    };
    n.is_finite().then_some(n)
}

/// Largest quantity on one cart line.
const MAX_LINE_QTY: f64 = 1_000_000.0;

/// A till line re-priced from the catalogue: the unit price (unless the user
/// may set their own), cost, modifier prices and the line totals come from
/// the database. Name, notes and kitchen state are kept as sent. None when
/// the line is not valid.
pub fn reprice_line(s: &Settings, cat: &Catalogue, line: &Value, item_based: bool, own_price: bool) -> Option<Value> {
    let mut o = line.as_object()?.clone();
    let qty = number(o.get("qty")).filter(|q| *q > 0.0 && *q <= MAX_LINE_QTY)?;
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
    let source = variant.unwrap_or(product);
    let price = if own_price { number(o.get("price")).filter(|p| *p >= 0.0)? } else { source.f64("price") };
    if !own_price {
        o.insert("price".into(), source.val("price"));
    }
    o.insert("cost".into(), source.val("cost"));

    let (mut mod_price, mut mod_cost) = (0.0, 0.0);
    match o.get_mut("modifiers") {
        None | Some(Value::Null) => {}
        Some(Value::Array(list)) => {
            for m in list.iter_mut() {
                let mo = m.as_object_mut()?;
                let mqty = number(mo.get("qty")).filter(|q| *q >= 0.0 && *q <= MAX_LINE_QTY)?;
                if !mo.get("is_checked").map(php::filter_bool).unwrap_or(false) {
                    continue;
                }
                // Only the product's own (category) modifiers can be picked.
                let row = cat.modifiers.get(&fk_id(mo.get("id")?)?)?;
                if row.opt_i64("food_category_id") != product.opt_i64("food_category_id") {
                    return None;
                }
                mod_price += mqty * row.f64("price");
                mod_cost += mqty * row.f64("cost");
                mo.insert("price".into(), row.val("price"));
                mo.insert("cost".into(), row.val("cost"));
            }
        }
        _ => return None,
    }

    let base = qty * price + mod_price;
    o.insert("sub_total".into(), crate::util::json_num(base));
    o.insert("modifiers_price".into(), crate::util::json_num(mod_price));
    o.insert("modifiers_cost".into(), crate::util::json_num(mod_cost));
    if item_based {
        // The tax picked for the line, else the product's, else the default.
        let chosen = o.get("tax_id").and_then(fk_id).and_then(|id| cat.taxes.get(&id));
        let default = match product.opt_i64("tax_id").filter(|t| *t != 0) {
            Some(id) => cat.taxes.get(&id),
            None => s.row.opt_i64("tax_id").and_then(|id| cat.taxes.get(&id)),
        };
        let setup = chosen.or(default).map(|t| tax_resource(s, t)).unwrap_or_else(|| order_tax(s));
        let rule = TaxRule::from_json(&setup);
        let tax = rule.tax_for(base);
        o.insert("tax_id".into(), setup.get("id").cloned().unwrap_or(Value::Null));
        o.insert("tax_setup".into(), setup);
        o.insert("tax_amount".into(), Value::from(format!("{tax:.2}")));
        if rule.included {
            o.insert("sub_total_before_tax".into(), crate::util::json_num(base - tax));
        } else {
            o.insert("sub_total_before_tax".into(), crate::util::json_num(base));
            o.insert("sub_total".into(), crate::util::json_num(base + tax));
        }
    }
    Some(Value::Object(o))
}

/// The order tax: a row of Settings > Taxes picked on the till (by id), else
/// the default from Settings > Tax. Rates never come from the request.
pub fn chosen_order_tax(s: &Settings, taxes: &HashMap<i64, Row>, sent: Option<&Value>) -> Value {
    sent.and_then(|t| t.get("id")).and_then(fk_id).and_then(|id| taxes.get(&id)).map(|r| pos_tax(s, r)).unwrap_or_else(|| order_tax(s))
}

/// Id of the user's open cash register.
pub async fn open_register_id(conn: &mut MySqlConnection, user_id: i64) -> AppResult<Option<i64>> {
    let row = tx_row(conn, "SELECT id FROM cash_books WHERE user_id = ? AND closed = 0 ORDER BY id LIMIT 1", vec![user_id.into()]).await?;
    Ok(row.map(|r| r.i64("id")))
}

/// Dates and filters shared by the sales list and the kitchen board.
pub fn sale_filters(q: &mut Sql, data: &Map<String, Value>, s: &Settings) {
    for (key, val) in data {
        if val.is_null() || val.as_str() == Some("") || val.as_array().map(|a| a.is_empty()).unwrap_or(false) {
            continue;
        }
        let method = key.strip_suffix("_id").unwrap_or(key).replace('.', "");
        let text = match val {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            Value::Bool(b) => (if *b { "1" } else { "" }).to_string(),
            _ => continue,
        };
        match method.as_str() {
            "search" => {
                q.and("tracking LIKE ?", s.search_pattern(&text));
            }
            "biller" => {
                q.and("biller_id = ?", text);
            }
            "customer" => {
                q.and("customer_id = ?", text);
            }
            "chef" => {
                q.and("chef_id = ?", text);
            }
            "payment_method" | "paymentMethod" => {
                q.and("payment_method_id = ?", text);
            }
            "taker" => {
                q.and("order_taker_id = ?", text);
            }
            "table" => {
                q.and("table_id = ?", text);
            }
            "order_type" | "orderType" => {
                q.and("order_type = ?", text);
            }
            "status" => {
                match text.as_str() {
                    "cancelled" => q.push(" AND is_cancelled = 1"),
                    "completed" => q.push(" AND completed_at IS NOT NULL AND is_cancelled = 0"),
                    "ready" => q.push(" AND prepared_at IS NOT NULL AND completed_at IS NULL AND is_cancelled = 0"),
                    "preparing" => q.push(" AND is_preparing = 1 AND prepared_at IS NULL AND completed_at IS NULL AND is_cancelled = 0"),
                    "submitted" => q.push(" AND (progress IS NULL OR progress = 0) AND completed_at IS NULL AND is_cancelled = 0"),
                    _ => q,
                };
            }
            _ => {}
        }
    }
}

/// Date range filter of the sales list (`duration` + optional dates/times).
pub fn advance_duration(q: &mut Sql, data: &Map<String, Value>, s: &Settings) {
    use chrono::{Datelike, Duration, NaiveDate, NaiveTime};
    let get = |k: &str| data.get(k).and_then(Value::as_str).map(str::to_string);
    let Some(interval) = get("duration") else { return };
    let now = s.now();
    let norm = |t: Option<String>, default: &str| -> String {
        match t {
            Some(t) if t.len() == 5 && NaiveTime::parse_from_str(&t, "%H:%M").is_ok() && t.as_bytes()[2] == b':' => format!("{t}:00"),
            Some(t) if t.len() == 8 && NaiveTime::parse_from_str(&t, "%H:%M:%S").is_ok() => t,
            _ => default.to_string(),
        }
    };
    let start_date = get("starting_date");
    let end_date = get("ending_date");
    let start_time = norm(get("starting_time"), "00:00:00");
    let end_time = norm(get("ending_time"), "23:59:59");
    let parse =
        |d: &Option<String>, t: &str| d.as_ref().and_then(|d| NaiveDateTime::parse_from_str(&format!("{d} {t}"), "%Y-%m-%d %H:%M:%S").ok());
    let epoch = NaiveDate::from_ymd_opt(1970, 1, 1).and_then(|d| d.and_hms_opt(0, 0, 0)).unwrap_or(now);
    let (mut start, mut end) = (
        if start_date.is_some() { parse(&start_date, &start_time) } else { Some(epoch) },
        if end_date.is_some() { parse(&end_date, &end_time) } else { Some(now) },
    );
    if start.is_none() || end.is_none() {
        start = Some(epoch);
        end = Some(now);
    }
    let (start, end) = (start.unwrap_or(epoch), end.unwrap_or(now));
    let day_start = |d: NaiveDate| d.and_hms_opt(0, 0, 0).unwrap_or(now);
    let day_end = |d: NaiveDate| d.and_hms_opt(23, 59, 59).unwrap_or(now);
    let between = |q: &mut Sql, a: NaiveDateTime, b: NaiveDateTime| {
        q.push_args(" AND created_at BETWEEN ? AND ?", [Arg::Time(a), Arg::Time(b)]);
    };
    let year_month = |q: &mut Sql, d: NaiveDateTime| {
        q.push_args(" AND YEAR(created_at) = ? AND MONTH(created_at) = ?", [Arg::Int(d.year() as i64), Arg::Int(d.month() as i64)]);
    };
    match interval.as_str() {
        "today" => between(q, day_start(now.date()), day_end(now.date())),
        "yesterday" => {
            q.and("DATE(created_at) = ?", Arg::Str((now.date() - Duration::days(1)).format("%Y-%m-%d").to_string()));
        }
        "weekly" => {
            let anchor = if start_date.is_some() { start } else { now };
            let monday = anchor.date() - Duration::days(anchor.weekday().num_days_from_monday() as i64);
            between(q, day_start(monday), day_end(monday + Duration::days(6)));
        }
        "monthly" => year_month(q, if start_date.is_some() { start } else { now }),
        "last_month" => year_month(q, php::add_months(&now, -1)),
        "yearly" => {
            let y = if start_date.is_some() { start.year() } else { now.year() };
            q.and("YEAR(created_at) = ?", Arg::Int(y as i64));
        }
        "last_three_months" => {
            let m = php::add_months(&now, -3);
            let first = NaiveDate::from_ymd_opt(m.year(), m.month(), 1).unwrap_or(m.date());
            between(q, day_start(first), end);
        }
        "last_year" => {
            q.and("YEAR(created_at) = ?", Arg::Int(now.year() as i64 - 1));
        }
        "last_seven_days" => between(q, now - Duration::days(7), now),
        "last_six_months" => between(q, php::add_months(&now, -6), now),
        "last_quarter" => {
            let qm = (now.month0() / 3) * 3 + 1;
            let q_start = NaiveDate::from_ymd_opt(now.year(), qm, 1).map(day_start).unwrap_or(now);
            let q_end_month = php::add_months(&q_start, 3);
            let q_end = day_end(q_end_month.date() - Duration::days(1));
            between(q, php::add_months(&q_start, -3), php::add_months(&q_end, -3));
        }
        "last_biannual" => {
            let jan = NaiveDate::from_ymd_opt(now.year(), 1, 1).map(day_start).unwrap_or(now);
            between(q, php::add_months(&jan, -6), now);
        }
        "last_biweek" => between(q, now - Duration::weeks(2), now),
        "last_work_week" => {
            let back = |target: chrono::Weekday| {
                let mut d = now.date() - Duration::days(1);
                while d.weekday() != target {
                    d -= Duration::days(1);
                }
                d
            };
            between(q, day_start(back(chrono::Weekday::Mon)), day_end(back(chrono::Weekday::Fri)));
        }
        "custom" => between(q, start, end),
        _ => {}
    }
}

/// Columns the order lists may be sorted by.
pub const SALE_SORT: [&str; 26] = [
    "id",
    "tracking",
    "order_type",
    "tax_amount",
    "cart_total_items",
    "cart_total_price",
    "cart_total_cost",
    "profit_after_all",
    "payable_after_all",
    "discount_rate",
    "discount_amount",
    "table_id",
    "order_taker_id",
    "took_at",
    "is_preparing",
    "chef_id",
    "prepared_at",
    "customer_id",
    "biller_id",
    "completed_at",
    "progress",
    "payment_method_id",
    "is_cancelled",
    "created_at",
    "updated_at",
    "tip_amount",
];

/// Response body with numbers written the way PHP's json_encode wrote them:
/// a float without a fraction (a `double` column such as 40.00) is an integer.
pub fn reply(v: Value) -> axum::Json<Value> {
    fn fix(v: Value) -> Value {
        match v {
            Value::Number(n) if n.is_f64() => match n.as_f64() {
                Some(f) if f.fract() == 0.0 && f.abs() < 1e15 => Value::from(f as i64),
                _ => Value::Number(n),
            },
            Value::Array(a) => Value::Array(a.into_iter().map(fix).collect()),
            Value::Object(o) => Value::Object(o.into_iter().map(|(k, x)| (k, fix(x))).collect()),
            other => other,
        }
    }
    axum::Json(fix(v))
}
