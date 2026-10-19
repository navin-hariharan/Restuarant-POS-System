//! Sales: the order list with its totals, order details, and the POS order
//! writes (create, edit, delete).

use super::pos::{
    common::{
        self, bool_col, by_ids, d, ids_of, json_col, items_list, load_pos_customers, load_staff, lock_sale, opt_pos_table, sale_by_uuid,
        set_table_booked, tx_exec, Row, ORDER_TYPES,
    },
    missing, php, validated,
};
use crate::{
    activity,
    auth::AuthUser,
    db::RowExt,
    error::{AppError, AppResult, Errors},
    input::Input,
    notify::{self, OrderEvent},
    query::Sql,
    state::AppState,
    stock,
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/sales", get(index).post(store))
        .route("/admin/sales/{sale}", get(show).put(update).patch(update).delete(destroy))
        .route("/admin/sale.filters", get(filters))
        .route("/admin/sale-orders-batch-remove", post(batch_remove))
}

async fn index(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(&["manage_sales"])?;
    let s = state.settings.get().await;
    let mut q = Sql::new("SELECT * FROM sales WHERE 1=1");
    common::sale_filters(&mut q, &input.data, &s);
    common::advance_duration(&mut q, &input.data, &s);

    let mut summary = Sql::new(q.text.replacen(
        "SELECT * FROM sales",
        "SELECT COUNT(*) AS count, COALESCE(SUM(cart_total_price), 0) AS net, COALESCE(SUM(tax_amount), 0) AS tax, \
         COALESCE(SUM(payable_after_all), 0) AS total FROM sales",
        1,
    ));
    summary.push(" AND is_cancelled = 0");
    summary.args = q.args.clone();
    let totals = summary.fetch_optional(&state.db).await?.unwrap_or_default();

    let (col, order) = input.sort(&common::SALE_SORT, "created_at", "asc");
    q.push(&format!(" ORDER BY `{col}` {order}, id {order}"));
    let (rows, pagination) = q.paginate(&state.db, input.page(10)).await?;
    let customers = load_pos_customers(&state, ids_of(&rows, "customer_id")).await?;
    let tables = by_ids(&state.db, "service_tables", ids_of(&rows, "table_id")).await?;
    let items: Vec<Value> = rows
        .iter()
        .map(|o| {
            json!({
                "id": o.val("id"),
                "uuid": o.val("uuid"),
                "tracking": o.val("tracking"),
                "cart_total_cost": o.val("cart_total_cost"),
                "cart_total_price": o.val("cart_total_price"),
                "tax_amount": o.val("tax_amount"),
                "payable_after_all": o.val("payable_after_all"),
                "discount_amount": o.val("discount_amount"),
                "tip_amount": o.val("tip_amount"),
                "is_preparing": bool_col(o, "is_preparing"),
                "shipping": null,
                "order_type": o.val("order_type"),
                "progress": o.val("progress"),
                "customer": o.opt_i64("customer_id").and_then(|c| customers.get(&c)).cloned().unwrap_or(Value::Null),
                "table": opt_pos_table(o.opt_i64("table_id").and_then(|t| tables.get(&t))),
                "took_at": o.val("took_at"),
                "prepared_at": o.val("prepared_at"),
                "completed_at": o.val("completed_at"),
                "is_cancelled": bool_col(o, "is_cancelled"),
                "created_at": d(&s, o, "created_at"),
                "updated_at": d(&s, o, "updated_at"),
            })
        })
        .collect();
    let num = |k: &str| crate::util::json_num(totals.f64(k));
    // The `tax` alias meets the model's JSON cast, which turns the sum into a
    // 14-digit string and back.
    let tax_sum = crate::util::json_num(php::float_string(totals.f64("tax")).parse::<f64>().unwrap_or(0.0));
    Ok(common::reply(json!({
        "items": items,
        "pagination": pagination.json(),
        "summary": { "count": totals.i64("count"), "net": num("net"), "tax": tax_sum, "total": num("total") },
    })))
}

async fn show(State(state): State<AppState>, user: AuthUser, Path(uuid): Path<String>) -> AppResult<Json<Value>> {
    user.require(&["manage_sales", "pos_portal"])?;
    let o = sale_by_uuid(&state.db, &uuid).await?;
    let s = state.settings.get().await;
    let staff = load_staff(&state, [o.opt_i64("chef_id"), o.opt_i64("biller_id"), o.opt_i64("order_taker_id")].into_iter().flatten()).await?;
    let person = |k: &str| o.opt_i64(k).and_then(|id| staff.get(&id)).cloned().unwrap_or(Value::Null);
    let customer = load_pos_customers(&state, o.opt_i64("customer_id")).await?.into_values().next().unwrap_or(Value::Null);
    let table = by_ids(&state.db, "service_tables", o.opt_i64("table_id")).await?;
    let method = by_ids(&state.db, "payment_methods", o.opt_i64("payment_method_id")).await?;
    let pickup = by_ids(&state.db, "pickup_points", o.opt_i64("pickup_point_id")).await?;
    Ok(common::reply(json!({
        "id": o.val("id"),
        "uuid": o.val("uuid"),
        "tracking": o.val("tracking"),
        "items": json_col(&o, "items"),
        "cart_total_price": o.val("cart_total_price"),
        "cart_total_cost": o.val("cart_total_cost"),
        "payable_after_all": o.val("payable_after_all"),
        "discount_rate": o.val("discount_rate"),
        "is_discount_in_percentage": bool_col(&o, "is_discount_in_percentage"),
        "discount_amount": o.val("discount_amount"),
        "staff_note": o.val("staff_note"),
        "payment_note": o.val("payment_note"),
        "tax": json_col(&o, "tax"),
        "profit_after_all": o.val("profit_after_all"),
        "tax_amount": o.val("tax_amount"),
        "chef": person("chef_id"),
        "biller": person("biller_id"),
        "taker": person("order_taker_id"),
        "customer": customer,
        "table": opt_pos_table(table.values().next()),
        "took_at": o.val("took_at"),
        "is_preparing": bool_col(&o, "is_preparing"),
        "progress": o.val("progress"),
        "is_cancelled": bool_col(&o, "is_cancelled"),
        "cancellation_reason": o.val("cancellation_reason"),
        "completed_at": o.val("completed_at"),
        "tip_amount": o.val("tip_amount"),
        "order_type": o.val("order_type"),
        "prepared_at": o.val("prepared_at"),
        "note_for_chef": o.val("note_for_chef"),
        "is_item_based_taxation": bool_col(&o, "is_item_based_taxation"),
        "payment_method": method.values().next().map(|m| common::payment_method(&s, m)).unwrap_or(Value::Null),
        "pickup_point": pickup.values().next().map(|p| common::pos_pickup(&s, p)).unwrap_or(Value::Null),
        "shipping_address": o.val("shipping_address"),
        "created_at": d(&s, &o, "created_at"),
        "updated_at": d(&s, &o, "updated_at"),
    })))
}

/// Does a record with this id exist (`exists:` rule)?
async fn exists_rule(state: &AppState, table: &'static str, v: &Value) -> AppResult<bool> {
    let Some(id) = common::fk_id(v) else { return Ok(false) };
    let mut conn = state.db.acquire().await?;
    common::exists(&mut conn, table, id).await
}

const STORE_RULES: [&str; 23] = [
    "order_type",
    "customer_id",
    "cart_total_cost",
    "cart_total_items",
    "cart_total_price",
    "profit_after_all",
    "items",
    "tax",
    "tax_amount",
    "progress",
    "payment_note",
    "staff_note",
    "note_for_chef",
    "chef_id",
    "prepared_at",
    "order_taker_id",
    "took_at",
    "is_spliting",
    "discount_amount",
    "discount_rate",
    "is_discount_in_percentage",
    "payable_after_all",
    "is_item_based_taxation",
];

const UPDATE_RULES: [&str; 18] = [
    "table_id",
    "order_type",
    "customer_id",
    "cart_total_cost",
    "cart_total_items",
    "cart_total_price",
    "profit_after_all",
    "items",
    "tax",
    "tax_amount",
    "progress",
    "payment_note",
    "staff_note",
    "note_for_chef",
    "discount_amount",
    "discount_rate",
    "is_discount_in_percentage",
    "payable_after_all",
];

const REQUIRED: [&str; 12] = [
    "order_type",
    "customer_id",
    "cart_total_cost",
    "cart_total_items",
    "cart_total_price",
    "profit_after_all",
    "items",
    "tax",
    "tax_amount",
    "progress",
    "payable_after_all",
    "is_item_based_taxation",
];

/// SaleStoreRequest / SaleUpdateRequest. Returns the rule keys in order.
async fn validate_order(state: &AppState, input: &Input, base: &[&str]) -> AppResult<Vec<&'static str>> {
    let s = state.settings.get().await;
    let modes = s.modes();
    let order_type = input.opt_str("order_type");
    let mut keys: Vec<&'static str> = base
        .iter()
        .filter_map(|k| STORE_RULES.iter().chain(UPDATE_RULES.iter()).find(|r| *r == k).copied())
        .collect();
    let extra: Option<&'static str> = match order_type.as_deref() {
        Some("dining") => Some("table_id"),
        Some("pickup") => Some("pickup_point_id"),
        Some("dilivery") => Some("shipping_address"),
        Some("roomservice") => Some("guest_room_reservation_id"),
        _ => None,
    };
    if let Some(e) = extra {
        if !keys.contains(&e) {
            keys.push(e);
        }
    }

    let mut errors = Errors::default();
    for k in &keys {
        match *k {
            "customer_id" if missing(input, k) => errors.add(k, "Customer is required"),
            "order_type" if !missing(input, k) && !ORDER_TYPES.contains(&order_type.as_deref().unwrap_or("")) => {
                errors.add(k, "The selected order type is invalid.")
            }
            "table_id" if order_type.as_deref() == Some("dining") => {
                if missing(input, k) {
                    if !modes.table_is_option {
                        errors.add(k, "Service table is required for dinning order");
                    }
                } else if !exists_rule(state, "service_tables", &input.val(k)).await? {
                    errors.add(k, "No table was found");
                }
            }
            "pickup_point_id" => {
                if !missing(input, k) && !exists_rule(state, "pickup_points", &input.val(k)).await? {
                    errors.add(k, "The selected pickup point id is invalid.");
                }
            }
            "guest_room_reservation_id" => {
                if missing(input, k) {
                    errors.add(k, "Please select guest room.");
                } else if !exists_rule(state, "guest_room_reservations", &input.val(k)).await? {
                    errors.add(k, "No room reservation was found");
                }
            }
            k if REQUIRED.contains(&k) && base.contains(&k) && missing(input, k) => {
                errors.add(k, format!("The {} field is required.", k.replace('_', " ")));
            }
            _ => {}
        }
    }
    if !missing(input, "items") && !matches!(input.get("items"), Some(Value::Array(_))) {
        errors.add("items", "The items must be an array");
    }
    errors.check()?;
    Ok(keys)
}

async fn store(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    user.require(&["pos_portal"])?;
    let keys = validate_order(&state, &input, &STORE_RULES).await?;
    let s = state.settings.get().await;
    let modes = s.modes();
    let now = s.now();
    let split = input.get("is_spliting").map(php::filter_bool).unwrap_or(false);

    let mut data = validated(&input, &keys);
    data.apply_order_type();
    if data.get("order_taker_id").map(Value::is_null).unwrap_or(true) {
        data.set("order_taker_id", Value::from(user.id));
    }
    if data.get("took_at").map(Value::is_null).unwrap_or(true) {
        data.set("took_at", Value::from(now.format("%Y-%m-%d %H:%M:%S").to_string()));
    }
    let uuid = crate::util::uuid();
    data.set("uuid", Value::from(uuid.clone()));
    let items = items_list(input.get("items"));
    data.set("items", Value::Array(items.clone()));
    let dining = data.get("order_type").and_then(Value::as_str) == Some("dining");

    let mut tx = state.db.begin().await?;
    if modes.cashbooks {
        let register = common::open_register_id(&mut tx, user.id).await?;
        data.set("cash_book_id", register.map(Value::from).unwrap_or(Value::Null));
    }
    // A table already being served can't take a second (non split) order.
    if !split && dining && common::table_is_serving(&mut tx, &modes, data.id("table_id")).await? {
        return Err(AppError::unprocessable("Attention! Table is being served"));
    }
    let cols = data.columns(&mut tx).await?;
    let (id, tracking) = common::insert_sale(&mut tx, cols, &uuid, now).await?;
    common::create_sale_items(&state, &mut tx, id, &items, now).await?;
    if dining {
        set_table_booked(&mut tx, data.id("table_id"), true, now).await?;
    }
    tx.commit().await?;
    activity::log(&state, &user, &headers, &state.t("New sale order created successfully").await, Some(&tracking)).await;
    if !split {
        notify::order_event(&state, id, OrderEvent::Created);
    }
    Ok(common::reply(json!({ "message": state.t("Operation completed successfully").await, "order": uuid })))
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    input: Input,
) -> AppResult<Json<Value>> {
    user.require(&["manage_sales", "pos_portal"])?;
    let sale = sale_by_uuid(&state.db, &uuid).await?;
    let keys = validate_order(&state, &input, &UPDATE_RULES).await?;
    let s = state.settings.get().await;
    let modes = s.modes();
    let now = s.now();

    let mut data = validated(&input, &keys);
    data.apply_order_type();
    if php::to_float(data.get("progress")) < 99.0 {
        data.set("prepared_at", Value::Null);
    }
    let items = items_list(input.get("items"));
    data.set("items", Value::Array(items.clone()));
    let dining = data.get("order_type").and_then(Value::as_str) == Some("dining");

    let mut tx = state.db.begin().await?;
    let sale = lock_sale(&mut tx, sale.i64("id")).await?;
    let checked_out = sale.opt_str("completed_at").is_some() && !sale.bool("is_cancelled");
    if checked_out && !modes.allow_to_edit_checked_orders {
        return Err(AppError::unprocessable("Unable to process the request, order is completed"));
    }
    let current_table = match sale.opt_i64("table_id") {
        Some(t) if common::exists(&mut tx, "service_tables", t).await? => Some(t),
        _ => None,
    };
    if let Some(current) = current_table {
        let wanted = data.id("table_id").unwrap_or(0);
        if dining && wanted != current && common::table_is_serving(&mut tx, &modes, data.id("table_id")).await? {
            return Err(AppError::unprocessable("Attention! Table is being served"));
        }
        // Free the current table before the order type or table changes.
        set_table_booked(&mut tx, Some(current), false, now).await?;
    }
    // An edited order that was already checked out moves stock by the difference.
    if checked_out {
        stock::restore(&mut tx, modes.item_consumption, &items_list(Some(&json_col(&sale, "items"))), now).await?;
        stock::deduct(&mut tx, modes.item_consumption, &items, now).await?;
    }
    let cols = data.columns(&mut tx).await?;
    common::update_sale(&mut tx, sale.i64("id"), cols, now).await?;
    tx_exec(&mut tx, "DELETE FROM sale_items WHERE sale_id = ?", vec![sale.i64("id").into()]).await?;
    common::create_sale_items(&state, &mut tx, sale.i64("id"), &items, now).await?;
    if dining {
        let table = if data.has("table_id") { data.id("table_id") } else { sale.opt_i64("table_id") };
        set_table_booked(&mut tx, table, true, now).await?;
    }
    tx.commit().await?;
    activity::log(&state, &user, &headers, &state.t("Sale order updated successfully").await, Some(&sale.str("tracking"))).await;
    Ok(common::reply(json!({ "message": state.t("Order updated successfully").await, "order": sale.str("uuid") })))
}

/// Delete one sale inside a transaction: free its table and, when it was
/// checked out (and not cancelled), put its ingredients back.
async fn remove_sale(conn: &mut sqlx::MySqlConnection, sale: &Row, consumption: bool, now: chrono::NaiveDateTime) -> AppResult<()> {
    if sale.str("order_type") == "dining" {
        set_table_booked(conn, sale.opt_i64("table_id"), false, now).await?;
    }
    if sale.opt_str("completed_at").is_some() && !sale.bool("is_cancelled") {
        stock::restore(conn, consumption, &items_list(Some(&json_col(sale, "items"))), now).await?;
    }
    tx_exec(conn, "DELETE FROM sales WHERE id = ?", vec![sale.i64("id").into()]).await?;
    Ok(())
}

async fn destroy(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(uuid): Path<String>) -> AppResult<Json<Value>> {
    user.require(&["remove_sales"])?;
    let sale = sale_by_uuid(&state.db, &uuid).await?;
    let s = state.settings.get().await;
    let now = s.now();
    let mut tx = state.db.begin().await?;
    let sale = lock_sale(&mut tx, sale.i64("id")).await?;
    remove_sale(&mut tx, &sale, s.modes().item_consumption, now).await?;
    tx.commit().await?;
    activity::log(&state, &user, &headers, &state.t("Sale order removed successfully").await, Some(&sale.str("tracking"))).await;
    Ok(common::reply(json!({ "message": state.t("Data removed successfully").await })))
}

async fn batch_remove(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    user.require(&["remove_sales"])?;
    let ids: Vec<i64> = match input.get("orders") {
        Some(Value::Array(a)) => a.iter().filter_map(common::fk_id).collect(),
        Some(Value::Object(o)) => o.values().filter_map(common::fk_id).collect(),
        Some(v) => common::fk_id(v).into_iter().collect(),
        None => vec![],
    };
    if missing(&input, "orders") {
        return Err(AppError::field("orders", "The orders field is required."));
    }
    let s = state.settings.get().await;
    let now = s.now();
    let mut removed = Vec::new();
    if !ids.is_empty() {
        let mut tx = state.db.begin().await?;
        let mut q = Sql::new("SELECT * FROM sales WHERE 1=1");
        q.and_in("id", ids.into_iter().take(1000));
        q.push(" ORDER BY id FOR UPDATE");
        let rows = common::tx_rows(&mut tx, &q.text, q.args.clone()).await?;
        for sale in &rows {
            remove_sale(&mut tx, sale, s.modes().item_consumption, now).await?;
            removed.push(sale.str("tracking"));
        }
        tx.commit().await?;
    }
    let msg = state.t("Sale order removed successfully").await;
    for tracking in removed {
        activity::log(&state, &user, &headers, &msg, Some(&tracking)).await;
    }
    Ok(common::reply(json!({ "message": state.t("The selected sale orders have been deleted").await })))
}

async fn filters(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(&["manage_sales", "overall_sale_report"])?;
    let s = state.settings.get().await;
    let tables = super::pos::table_list(&state).await?;
    let staff = |rows: Vec<Row>| -> Vec<i64> { ids_of(&rows, "id") };
    let billers = staff(common::users_of_role(&state.db, 4).await?);
    let takers = staff(common::users_of_role(&state.db, 2).await?);
    let chefs = staff(common::users_of_role(&state.db, 3).await?);
    let built = load_staff(&state, billers.iter().chain(&takers).chain(&chefs).copied()).await?;
    let list = |ids: &[i64]| -> Vec<Value> { ids.iter().filter_map(|id| built.get(id).cloned()).collect() };
    let methods = Sql::new("SELECT * FROM payment_methods ORDER BY id").fetch_all(&state.db).await?;
    Ok(common::reply(json!({
        "tables": tables,
        "billers": list(&billers),
        "takers": list(&takers),
        "chefs": list(&chefs),
        "methods": methods.iter().map(|m| common::payment_method(&s, m)).collect::<Vec<_>>(),
    })))
}

