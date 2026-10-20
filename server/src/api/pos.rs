//! POS screen: lists for the till (products, categories, customers, tables,
//! taxes...), the kitchen board, order checkout / cancellation / progress,
//! and guest room check-in and checkout.

pub mod common;
pub mod php;

use self::common::{
    bool_col, by_ids, d, ids_of, items_list, json_col, load_pos_customers, lock_sale, opt_pos_pickup, opt_pos_table, pos_modifier,
    pos_payment_method, pos_pickup, pos_table, pos_tax, sale_by_uuid, set_table_booked, tax_resource, tx_exec, tx_row, Row, SaleData,
    TaxRule,
};
use crate::{
    activity,
    auth::AuthUser,
    db::RowExt,
    error::{AppError, AppResult, Errors},
    input::Input,
    notify::{self, OrderEvent},
    query::{paged, Arg, Sql},
    settings::Settings,
    state::AppState,
    stock,
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/pos/check-in-reservation", post(check_in))
        .route("/pos/taxes", get(taxes))
        .route("/pos/categories", get(categories))
        .route("/pos/pickup-points", get(pickup_points))
        .route("/pos/payment-methods", get(payment_methods))
        .route("/pos/avl-service-tables", get(service_tables))
        .route("/pos/guest-rooms-reservations", get(reservations))
        .route("/pos/products", get(products))
        .route("/pos/modifiers", get(modifiers))
        .route("/pos/customers", get(customers))
        .route("/pos/kitchen-orders", get(kitchen_orders))
        .route("/pos/order-progress/{sale}", post(order_progress))
        .route("/pos/checkout/{sale}", post(checkout))
        .route("/pos/submited-sale", post(submitted_order))
        .route("/pos/get-submitted-orders", get(submitted_orders))
        .route("/pos/pos.cancel-orders/{sale}", post(cancel_order))
        .route("/admin/guest-reservation-checkout/{reservation}", post(reservation_checkout))
}

const LIST_PERMISSIONS: [&str; 3] = ["pos_portal", "manage_sales", "manage_reservations"];

/// the `required`: present and not null, blank or an empty list.
pub fn missing(input: &Input, key: &str) -> bool {
    match input.get(key) {
        None => true,
        Some(Value::String(s)) => s.trim().is_empty(),
        Some(Value::Array(a)) => a.is_empty(),
        Some(Value::Object(o)) => o.is_empty(),
        Some(_) => false,
    }
}

pub fn require_fields(input: &Input, errors: &mut Errors, keys: &[&str]) {
    for k in keys {
        if missing(input, k) {
            errors.add(k, format!("The {} field is required.", k.replace('_', " ")));
        }
    }
}

/// The request values of `keys` that were sent (only validated fields), in rule order.
pub fn validated(input: &Input, keys: &[&str]) -> SaleData {
    SaleData(keys.iter().filter(|k| input.present(k)).map(|k| (k.to_string(), input.val(k))).collect())
}

/* ------------------------------------------------------------- lists */

async fn taxes(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(&LIST_PERMISSIONS)?;
    let s = state.settings.get().await;
    let rows = Sql::new("SELECT * FROM taxes ORDER BY id").fetch_all(&state.db).await?;
    Ok(common::reply(Value::Array(rows.iter().map(|r| pos_tax(&s, r)).collect())))
}

pub async fn category_list(state: &AppState) -> AppResult<Vec<Value>> {
    let rows = Sql::new("SELECT * FROM food_categories ORDER BY id").fetch_all(&state.db).await?;
    Ok(rows
        .iter()
        .map(|r| {
            let image = match r.opt_str("image").filter(|i| !i.is_empty()) {
                Some(i) => state.storage_url(&i),
                None => state.asset_url("images/default/category.png"),
            };
            json!({ "id": r.val("id"), "name": r.val("name"), "image": image })
        })
        .collect())
}

async fn categories(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(&LIST_PERMISSIONS)?;
    Ok(common::reply(Value::Array(category_list(&state).await?)))
}

async fn pickup_points(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(&LIST_PERMISSIONS)?;
    let s = state.settings.get().await;
    let rows = Sql::new("SELECT * FROM pickup_points ORDER BY created_at DESC, id ASC").fetch_all(&state.db).await?;
    Ok(common::reply(Value::Array(rows.iter().map(|r| pos_pickup(&s, r)).collect())))
}

async fn payment_methods(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(&LIST_PERMISSIONS)?;
    let rows = Sql::new("SELECT * FROM payment_methods ORDER BY id").fetch_all(&state.db).await?;
    Ok(common::reply(Value::Array(rows.iter().map(pos_payment_method).collect())))
}

pub async fn table_list(state: &AppState) -> AppResult<Vec<Value>> {
    let rows = Sql::new("SELECT * FROM service_tables ORDER BY id").fetch_all(&state.db).await?;
    Ok(rows.iter().map(pos_table).collect())
}

async fn service_tables(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(&LIST_PERMISSIONS)?;
    Ok(common::reply(Value::Array(table_list(&state).await?)))
}

async fn reservations(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(&LIST_PERMISSIONS)?;
    Ok(common::reply(Value::Array(common::checked_in_reservations(&state).await?)))
}

pub async fn modifier_list(state: &AppState, public: bool) -> AppResult<Vec<Value>> {
    let s = state.settings.get().await;
    let rows = Sql::new("SELECT * FROM modifiers ORDER BY id").fetch_all(&state.db).await?;
    Ok(rows.iter().map(|r| pos_modifier(&s, r, public)).collect())
}

async fn modifiers(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(&LIST_PERMISSIONS)?;
    Ok(common::reply(Value::Array(modifier_list(&state, false).await?)))
}

/// Columns the product lists may be sorted by.
const PRODUCT_SORT: [&str; 12] = [
    "id",
    "uuid",
    "sku",
    "name",
    "price",
    "cost",
    "food_category_id",
    "created_at",
    "updated_at",
    "is_bar_type",
    "has_variants",
    "expiry_date",
];

/// A page of PosFoodItemResource (POS and digital menu).
pub async fn product_page(state: &AppState, input: &Input, public: bool) -> AppResult<Value> {
    let s = state.settings.get().await;
    let mut q = Sql::new("SELECT * FROM food_items WHERE 1=1");
    for (key, val) in &input.data {
        let text = match val {
            Value::String(t) => t.clone(),
            Value::Number(n) => n.to_string(),
            _ => continue,
        };
        match key.strip_suffix("_id").unwrap_or(key) {
            "search" => {
                let p = s.search_pattern(&text);
                q.push_args(" AND (name LIKE ? OR sku LIKE ?)", [p.clone(), p]);
            }
            "category" => {
                q.and("food_category_id = ?", text);
            }
            _ => {}
        }
    }
    if s.modes().allow_expiry_date {
        q.push(" AND (expiry_date IS NULL OR DATE(expiry_date) >= ?)");
        q.args.push(Arg::Str(s.now().format("%Y-%m-%d").to_string()));
    }
    let (col, order) = input.sort(&PRODUCT_SORT, "created_at", "asc");
    q.push(&format!(" ORDER BY `{col}` {order}, id {order}"));
    let (rows, pagination) = q.paginate(&state.db, input.page(18)).await?;
    let items = product_resources(state, &s, &rows, public).await?;
    Ok(paged(items, pagination))
}

/// PosFoodItemResource for each product row.
pub async fn product_resources(state: &AppState, s: &Settings, rows: &[Row], public: bool) -> AppResult<Vec<Value>> {
    let taxes: HashMap<i64, Row> =
        Sql::new("SELECT * FROM taxes").fetch_all(&state.db).await?.into_iter().map(|r| (r.i64("id"), r)).collect();
    let default_tax = s.row.opt_i64("tax_id").and_then(|id| taxes.get(&id));
    let tax_setup = |p: &Row| -> Value {
        let t = match p.opt_i64("tax_id").filter(|t| *t != 0) {
            Some(id) => taxes.get(&id),
            None => default_tax,
        };
        t.map(|t| tax_resource(s, t)).unwrap_or(Value::Null)
    };
    let image = |p: &Row| match p.opt_str("image").filter(|i| !i.is_empty()) {
        Some(i) => state.storage_url(&i),
        None => state.asset_url("images/default/product.png"),
    };

    let mut modifiers: HashMap<i64, Vec<Value>> = HashMap::new();
    let cats = ids_of(rows, "food_category_id");
    if !cats.is_empty() {
        let mut q = Sql::new("SELECT * FROM modifiers WHERE 1=1");
        q.and_in("food_category_id", cats);
        q.push(" ORDER BY id");
        for m in q.fetch_all(&state.db).await? {
            modifiers.entry(m.i64("food_category_id")).or_default().push(pos_modifier(s, &m, public));
        }
    }
    let mut variants: HashMap<i64, Vec<Row>> = HashMap::new();
    let mut recipes: HashMap<i64, Vec<Value>> = HashMap::new();
    let ids = ids_of(rows, "id");
    if !ids.is_empty() {
        let mut q = Sql::new("SELECT * FROM food_item_attributes WHERE 1=1");
        q.and_in("food_item_id", ids);
        q.push(" ORDER BY id");
        let attrs = q.fetch_all(&state.db).await?;
        let attr_ids = ids_of(&attrs, "id");
        if !public && !attr_ids.is_empty() {
            let mut q = Sql::new("SELECT i.*, p.food_item_attribute_id AS pivot_owner, p.quantity AS pivot_quantity FROM ingredients i JOIN food_items_ingredients p ON p.ingredient_id = i.id WHERE 1=1");
            q.and_in("p.food_item_attribute_id", attr_ids);
            q.push(" ORDER BY p.id");
            for i in q.fetch_all(&state.db).await? {
                let using = match i.val("pivot_quantity") {
                    Value::Null => Value::from(0),
                    v => v,
                };
                recipes.entry(i.i64("pivot_owner")).or_default().push(json!({
                    "id": i.val("id"),
                    "name": i.val("name"),
                    "price": i.val("price"),
                    "cost": i.val("cost"),
                    "unit": i.val("unit"),
                    "alert_quantity": i.val("alert_quantity"),
                    "quantity": i.val("quantity"),
                    "quantity_using": using,
                    "created_at": d(s, &i, "created_at"),
                    "updated_at": d(s, &i, "updated_at"),
                }));
            }
        }
        for a in attrs {
            variants.entry(a.i64("food_item_id")).or_default().push(a);
        }
    }
    let cost = |r: &Row| if public { Value::Null } else { r.val("cost") };

    Ok(rows
        .iter()
        .map(|p| {
            let mods = modifiers.get(&p.i64("food_category_id")).cloned().unwrap_or_default();
            let vlist: Vec<Value> = variants
                .get(&p.i64("id"))
                .map(|list| {
                    list.iter()
                        .map(|a| {
                            let mut m = Map::new();
                            m.insert("id".into(), a.val("id"));
                            m.insert("uuid".into(), a.val("uuid"));
                            m.insert("food_item_id".into(), p.val("id"));
                            m.insert("food_item_name".into(), p.val("name"));
                            m.insert("name".into(), a.val("name"));
                            m.insert("image".into(), Value::from(image(p)));
                            m.insert("price".into(), a.val("price"));
                            m.insert("cost".into(), cost(a));
                            m.insert("sku".into(), a.val("sku"));
                            m.insert("tax_setup".into(), tax_setup(p));
                            if !public {
                                m.insert("ingredients".into(), Value::Array(recipes.get(&a.i64("id")).cloned().unwrap_or_default()));
                            }
                            m.insert("modifiers".into(), Value::Array(mods.clone()));
                            m.insert("updated_at".into(), d(s, a, "updated_at"));
                            m.insert("created_at".into(), d(s, a, "created_at"));
                            m.insert("is_bar_type".into(), bool_col(p, "is_bar_type"));
                            m.insert("in_stock".into(), Value::from(200));
                            Value::Object(m)
                        })
                        .collect()
                })
                .unwrap_or_default();
            json!({
                "id": p.val("id"),
                "uuid": p.val("uuid"),
                "category_id": p.val("food_category_id"),
                "name": p.val("name"),
                "image": image(p),
                "sku": p.val("sku"),
                "cost": cost(p),
                "price": p.val("price"),
                "food_item_id": null,
                "modifiers": mods,
                "is_bar_type": bool_col(p, "is_bar_type"),
                "description": p.val("description"),
                "in_stock": 200,
                "has_variants": bool_col(p, "has_variants"),
                "tax_setup": tax_setup(p),
                "variants": vlist,
            })
        })
        .collect())
}

async fn products(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(&LIST_PERMISSIONS)?;
    Ok(common::reply(product_page(&state, &input, false).await?))
}

async fn customers(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(&LIST_PERMISSIONS)?;
    let s = state.settings.get().await;
    let mut q = Sql::new("SELECT id FROM customers WHERE 1=1");
    match input.opt_str("search") {
        Some(term) => {
            let p = s.search_pattern(&term);
            q.push_args(" AND (name LIKE ? OR email LIKE ? OR phone LIKE ? OR address LIKE ?)", [p.clone(), p.clone(), p.clone(), p]);
            q.push(" ORDER BY id LIMIT 100");
        }
        None => {
            q.push(" AND id = 1");
        }
    }
    let ids = ids_of(&q.fetch_all(&state.db).await?, "id");
    let built = load_pos_customers(&state, ids.iter().copied()).await?;
    Ok(common::reply(Value::Array(ids.iter().filter_map(|id| built.get(id).cloned()).collect())))
}

/* ------------------------------------------------------- kitchen board */

async fn kitchen_orders(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(&["kitchen_portal"])?;
    let s = state.settings.get().await;
    let mut q = Sql::new("SELECT * FROM sales WHERE 1=1");
    common::sale_filters(&mut q, &input.data, &s);
    q.push(" AND is_cancelled = 0 AND prepared_at IS NULL ORDER BY id");
    let sales = q.fetch_all(&state.db).await?;

    let tables = by_ids(&state.db, "service_tables", ids_of(&sales, "table_id")).await?;
    let pickups = by_ids(&state.db, "pickup_points", ids_of(&sales, "pickup_point_id")).await?;
    let customers = load_pos_customers(&state, ids_of(&sales, "customer_id")).await?;
    let reservations = by_ids(&state.db, "guest_room_reservations", ids_of(&sales, "guest_room_reservation_id")).await?;
    let rooms = by_ids(&state.db, "guest_rooms", ids_of(&reservations.values().cloned().collect::<Vec<_>>(), "guest_room_id")).await?;

    let orders: Vec<Value> = sales
        .iter()
        .map(|o| {
            let reservation = o.opt_i64("guest_room_reservation_id").and_then(|id| reservations.get(&id)).map(|r| {
                let room = r.opt_i64("guest_room_id").and_then(|g| rooms.get(&g)).map(|g| g.val("room_name")).unwrap_or(Value::Null);
                json!({ "id": r.val("id"), "tracking": r.val("tracking"), "room": room })
            });
            json!({
                "id": o.val("id"),
                "uuid": o.val("uuid"),
                "tracking": o.val("tracking"),
                "items": json_col(o, "items"),
                "table": o.opt_i64("table_id").and_then(|t| tables.get(&t)).map(|t| common::full_table(&state, &s, t)).unwrap_or(Value::Null),
                "customer": o.opt_i64("customer_id").and_then(|c| customers.get(&c)).cloned().unwrap_or(Value::Null),
                "chef_id": o.val("chef_id"),
                "order_type": o.val("order_type"),
                "took_at": o.val("took_at"),
                "note_for_chef": o.val("note_for_chef"),
                "pickup_point": opt_pos_pickup(&s, o.opt_i64("pickup_point_id").and_then(|p| pickups.get(&p))),
                "shipping_address": o.val("shipping_address"),
                "guest_room_reservation": reservation.unwrap_or(Value::Null),
                "created_at": d(&s, o, "created_at"),
                "updated_at": d(&s, o, "updated_at"),
            })
        })
        .collect();
    let chefs: Vec<Value> = common::users_of_role(&state.db, 3)
        .await?
        .iter()
        .map(|u| common::model_array(&s, u, &[], &["email_verified_at"], &["password", "remember_token"]))
        .collect();
    Ok(common::reply(json!({ "orders": orders, "chefs": chefs })))
}

async fn order_progress(
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    input: Input,
) -> AppResult<Json<Value>> {
    user.require(&["kitchen_portal", "pos_portal"])?;
    let sale = sale_by_uuid(&state.db, &uuid).await?;
    if missing(&input, "chef_id") {
        return Err(AppError::field("chef_id", "Please specify the chef"));
    }
    let Some(progress) = common::number(input.get("progress")).filter(|p| (0.0..=100.0).contains(p)) else {
        return Err(AppError::field("progress", "The selected progress is invalid."));
    };
    let s = state.settings.get().await;
    let now = s.now();
    let mut data = SaleData::default();
    data.set("progress", crate::util::json_num(progress));
    data.set("chef_id", input.val("chef_id"));
    data.set("is_preparing", Value::Bool(progress > 0.0));
    data.set("prepared_at", if progress > 99.0 { Value::from(now.format("%Y-%m-%d %H:%M:%S").to_string()) } else { Value::Null });

    let mut tx = state.db.begin().await?;
    let sale = lock_sale(&mut tx, sale.i64("id")).await?;
    if sale.bool("is_cancelled") {
        return Err(AppError::unprocessable("This order has been cancelled"));
    }
    // The kitchen only ticks lines off: take each line's ready flag, nothing else.
    let stored = items_list(Some(&json_col(&sale, "items")));
    data.set("items", Value::Array(merge_ready(&stored, &items_list(input.get("items")))));
    let cols = data.columns(&mut tx).await?;
    common::update_sale(&mut tx, sale.i64("id"), cols, now).await?;
    tx.commit().await?;
    activity::log(&state, &user, &headers, &state.t("Order information updated successfully").await, Some(&sale.str("tracking"))).await;
    Ok(common::reply(json!({ "message": state.t("Order information updated successfully").await })))
}

/* ------------------------------------------------------ order actions */

async fn checkout(
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    input: Input,
) -> AppResult<Json<Value>> {
    user.require(&["order_checkout"])?;
    let sale = sale_by_uuid(&state.db, &uuid).await?;
    let mut errors = Errors::default();
    require_fields(
        &input,
        &mut errors,
        &["items", "discount_rate", "discount_amount", "tax_amount", "tax", "profit_after_all", "payable_after_all", "payment_method_id"],
    );
    errors.check()?;
    let mut data = validated(
        &input,
        &[
            "items",
            "discount_rate",
            "discount_amount",
            "tax_amount",
            "tax",
            "profit_after_all",
            "payable_after_all",
            "payment_note",
            "staff_note",
            "payment_method_id",
            "tip_amount",
        ],
    );
    let s = state.settings.get().await;
    let modes = s.modes();
    let now = s.now();
    // Prices and totals are worked out here from the catalogue, never taken from the till.
    let sent_items = items_list(input.get("items"));
    let cat = common::catalogue(&state, &sent_items).await?;
    let own_price = user.can("apply_discount");
    let mut items = Vec::with_capacity(sent_items.len());
    for l in &sent_items {
        let line = common::reprice_line(&s, &cat, l, modes.item_based_tax, own_price);
        items.push(line.ok_or_else(|| AppError::field("items", "The selected items are invalid."))?);
    }
    let percent = match input.get("is_discount_in_percentage") {
        Some(v) if !v.is_null() => php::filter_bool(v),
        _ => sale.bool("is_discount_in_percentage"),
    };
    let rate = common::number(input.get("discount_rate"));
    let tip = match input.get("tip_amount") {
        None | Some(Value::Null) => Some(0.0),
        v => common::number(v),
    };
    if let Some(key) = adjustment_error(rate, percent, common::number(input.get("discount_amount")), tip) {
        return Err(AppError::field(key, format!("The selected {} is invalid.", key.replace('_', " "))));
    }
    let tax = common::chosen_order_tax(&s, &cat.taxes, input.get("tax"));
    let t = common::totals(&items, modes.item_based_tax, &TaxRule::from_json(&tax), rate.unwrap_or(0.0), percent);
    if t.discount > t.price + 1e-9 {
        return Err(AppError::field("discount_amount", "The selected discount amount is invalid."));
    }
    if t.discount > 0.0 && !user.can("apply_discount") {
        return Err(AppError::forbidden("You do not have permission to apply a discount."));
    }
    let payable = common::money(t.total);
    if !total_matches(common::number(input.get("payable_after_all")), payable) {
        return Err(AppError::unprocessable("The order total does not match the items."));
    }
    let n = crate::util::json_num;
    data.set("items", Value::Array(items.clone()));
    data.set("tax", tax);
    data.set("tax_amount", n(common::money(t.tax)));
    data.set("cart_total_items", n(t.items));
    data.set("cart_total_price", n(common::money(t.net)));
    data.set("cart_total_cost", n(common::money(t.cost)));
    data.set("discount_rate", n(rate.unwrap_or(0.0)));
    data.set("discount_amount", n(common::money(t.discount)));
    data.set("is_discount_in_percentage", Value::Bool(percent));
    data.set("is_item_based_taxation", Value::Bool(modes.item_based_tax));
    data.set("profit_after_all", n(common::money(t.profit)));
    data.set("payable_after_all", n(payable));
    data.set("tip_amount", n(tip.unwrap_or(0.0)));

    let mut tx = state.db.begin().await?;
    // Locked so two tills cannot check out the same order at once.
    let sale = lock_sale(&mut tx, sale.i64("id")).await?;
    if sale.bool("is_cancelled") {
        return Err(AppError::unprocessable("This order has been cancelled"));
    }
    let was_completed = sale.opt_str("completed_at").is_some();
    if was_completed && !modes.allow_to_edit_checked_orders {
        return Err(AppError::unprocessable("Unable to process the request, order is completed"));
    }
    // Stock follows the final items; a second checkout first puts back what the first one took.
    if was_completed {
        stock::restore(&mut tx, modes.item_consumption, &items_list(Some(&json_col(&sale, "items"))), now).await?;
    }
    stock::deduct(&mut tx, modes.item_consumption, &items, now).await?;
    data.set("completed_at", Value::from(now.format("%Y-%m-%d %H:%M:%S").to_string()));
    data.set("biller_id", Value::from(user.id));
    if sale.str("order_type") == "dining" {
        set_table_booked(&mut tx, sale.opt_i64("table_id"), false, now).await?;
    }
    let cols = data.columns(&mut tx).await?;
    common::update_sale(&mut tx, sale.i64("id"), cols, now).await?;
    if was_completed {
        tx_exec(&mut tx, "DELETE FROM sale_items WHERE sale_id = ?", vec![sale.i64("id").into()]).await?;
        common::create_sale_items(&state, &mut tx, sale.i64("id"), &items, now).await?;
    }
    tx.commit().await?;
    activity::log(&state, &user, &headers, &state.t("Order checkout successfully").await, Some(&sale.str("tracking"))).await;
    notify::order_event(&state, sale.i64("id"), OrderEvent::Checkout);
    Ok(common::reply(json!({ "message": state.t("Processed successfully").await })))
}

async fn cancel_order(
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    input: Input,
) -> AppResult<Json<Value>> {
    user.require(&["pos_portal", "manage_sales"])?;
    let sale = sale_by_uuid(&state.db, &uuid).await?;
    let mut errors = Errors::default();
    require_fields(&input, &mut errors, &["is_cancelled", "cancellation_reason"]);
    errors.check()?;
    let cancelling = php::filter_bool(&input.val("is_cancelled"));
    let mut data = SaleData::default();
    data.set("is_cancelled", Value::Bool(cancelling));
    data.set("cancellation_reason", input.val("cancellation_reason"));
    let s = state.settings.get().await;
    let modes = s.modes();
    let now = s.now();

    let mut tx = state.db.begin().await?;
    let sale = lock_sale(&mut tx, sale.i64("id")).await?;
    let completed = sale.opt_str("completed_at").is_some();
    // A paid sale is only cancelled (or restored) by someone who may remove sales.
    if completed {
        user.require(&["remove_sales"])?;
    }
    let change = cancel_change(sale.bool("is_cancelled"), cancelling);
    let dining = sale.str("order_type") == "dining";
    // Stock is held exactly once while a checked-out sale is not cancelled.
    let items = items_list(Some(&json_col(&sale, "items")));
    match change {
        CancelChange::Cancel => {
            if completed {
                stock::restore(&mut tx, modes.item_consumption, &items, now).await?;
            }
            if dining {
                set_table_booked(&mut tx, sale.opt_i64("table_id"), false, now).await?;
            }
        }
        CancelChange::Restore => {
            if completed {
                stock::deduct(&mut tx, modes.item_consumption, &items, now).await?;
            } else if dining {
                // An open order holds its table again, as a new one would.
                set_table_booked(&mut tx, sale.opt_i64("table_id"), true, now).await?;
            }
        }
        CancelChange::None => {}
    }
    let cols = data.columns(&mut tx).await?;
    common::update_sale(&mut tx, sale.i64("id"), cols, now).await?;
    tx.commit().await?;
    activity::log(&state, &user, &headers, &state.t("Order information cancelled successfully").await, Some(&sale.str("tracking"))).await;
    notify::order_event(&state, sale.i64("id"), OrderEvent::Cancelled);
    Ok(common::reply(json!({ "message": state.t("Cancelled successfully").await })))
}

/// The stored order lines with the kitchen's ready flags applied. Lines are
/// matched by cart_uuid, or by position for lines without one.
fn merge_ready(stored: &[Value], sent: &[Value]) -> Vec<Value> {
    let key = |v: &Value| v.get("cart_uuid").and_then(Value::as_str).filter(|k| !k.is_empty()).map(str::to_string);
    stored
        .iter()
        .enumerate()
        .map(|(i, line)| {
            let from = match key(line) {
                Some(k) => sent.iter().find(|s| key(s).as_deref() == Some(k.as_str())),
                None => sent.get(i).filter(|s| key(s).is_none()),
            };
            let mut line = line.clone();
            if let (Some(obj), Some(ready)) = (line.as_object_mut(), from.and_then(|f| f.get("is_ready"))) {
                obj.insert("is_ready".into(), Value::Bool(php::filter_bool(ready)));
            }
            line
        })
        .collect()
}

/// The first discount or tip value of a checkout that is out of range.
fn adjustment_error(rate: Option<f64>, percent: bool, amount: Option<f64>, tip: Option<f64>) -> Option<&'static str> {
    if !rate.is_some_and(|r| r >= 0.0 && (!percent || r <= 100.0)) {
        return Some("discount_rate");
    }
    if !amount.is_some_and(|a| a >= 0.0) {
        return Some("discount_amount");
    }
    if !tip.is_some_and(|t| t >= 0.0) {
        return Some("tip_amount");
    }
    None
}

/// The till's total agrees with the server's to the cent.
fn total_matches(sent: Option<f64>, ours: f64) -> bool {
    sent.is_some_and(|v| (v - ours).abs() <= 0.01 + 1e-9)
}

#[derive(Debug, PartialEq)]
enum CancelChange {
    Cancel,
    Restore,
    None,
}

/// What a cancel request does to a sale that is (or is not) cancelled now.
fn cancel_change(was_cancelled: bool, cancelling: bool) -> CancelChange {
    match (was_cancelled, cancelling) {
        (false, true) => CancelChange::Cancel,
        (true, false) => CancelChange::Restore,
        _ => CancelChange::None,
    }
}

/// PosBillingSaleOrderResource: an open order loaded back into the till.
async fn billing_order(state: &AppState, o: &Row) -> AppResult<Value> {
    let s = state.settings.get().await;
    let table = match o.opt_i64("table_id") {
        Some(id) => by_ids(&state.db, "service_tables", [id]).await?.remove(&id),
        None => None,
    };
    let pickup = match o.opt_i64("pickup_point_id") {
        Some(id) => by_ids(&state.db, "pickup_points", [id]).await?.remove(&id),
        None => None,
    };
    let customer = load_pos_customers(state, o.opt_i64("customer_id")).await?.into_values().next().unwrap_or(Value::Null);
    let reservation = match o.opt_i64("guest_room_reservation_id") {
        Some(id) => {
            let rows: Vec<Row> = by_ids(&state.db, "guest_room_reservations", [id]).await?.into_values().collect();
            let parts = common::reservation_parts(state, &s, &rows).await?;
            rows.first().map(|r| common::pos_reservation(&s, &parts, r)).unwrap_or(Value::Null)
        }
        None => Value::Null,
    };
    Ok(json!({
        "id": o.val("id"),
        "uuid": o.val("uuid"),
        "tracking": o.val("tracking"),
        "customer_id": o.val("customer_id"),
        "items": json_col(o, "items"),
        "cart_total_price": o.val("cart_total_price"),
        "cart_total_cost": o.val("cart_total_cost"),
        "payable_after_all": o.val("payable_after_all"),
        "discount_rate": o.val("discount_rate"),
        "is_discount_in_percentage": bool_col(o, "is_discount_in_percentage"),
        "discount_amount": o.val("discount_amount"),
        "service_table": opt_pos_table(table.as_ref()),
        "customer": customer,
        "order_type": o.val("order_type"),
        "recipient_amount": 0,
        "payment_method_id": o.opt_i64("payment_method_id").unwrap_or(1),
        "pickup_point": opt_pos_pickup(&s, pickup.as_ref()),
        "guest_room_reservation": reservation,
        "guest_room_reservation_id": o.val("guest_room_reservation_id"),
        "tax": json_col(o, "tax"),
        "tip_amount": o.val("tip_amount"),
        "shipping_address": o.val("shipping_address"),
        "tax_amount": o.val("tax_amount"),
        "progress": o.val("progress"),
        "payment_note": o.val("payment_note"),
        "staff_note": o.val("staff_note"),
        "note_for_chef": o.val("note_for_chef"),
        "took_at": o.val("took_at"),
        "prepared_at": o.val("prepared_at"),
        "chef_id": o.val("chef_id"),
        "order_taker_id": o.val("order_taker_id"),
        "is_item_based_taxation": bool_col(o, "is_item_based_taxation"),
        "created_at": d(&s, o, "created_at"),
        "updated_at": d(&s, o, "updated_at"),
    }))
}

async fn submitted_order(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(&["pos_portal"])?;
    let s = state.settings.get().await;
    let mut q = Sql::new("SELECT * FROM sales WHERE uuid = ?");
    q.args.push(Arg::from(input.opt_str("uuid")));
    if !s.modes().allow_to_edit_checked_orders {
        q.push(" AND is_cancelled = 0 AND completed_at IS NULL");
    }
    q.push(" ORDER BY id LIMIT 1");
    match q.fetch_optional(&state.db).await? {
        Some(o) => Ok(common::reply(billing_order(&state, &o).await?)),
        None => Ok(common::reply(json!({ "message": state.t("Unable to process the request, order is completed").await }))),
    }
}

async fn submitted_orders(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(&["pos_portal"])?;
    let s = state.settings.get().await;
    let sales = Sql::new("SELECT * FROM sales WHERE is_cancelled = 0 AND completed_at IS NULL ORDER BY created_at DESC, id ASC")
        .fetch_all(&state.db)
        .await?;
    let tables = by_ids(&state.db, "service_tables", ids_of(&sales, "table_id")).await?;
    let pickups = by_ids(&state.db, "pickup_points", ids_of(&sales, "pickup_point_id")).await?;
    let customers = load_pos_customers(&state, ids_of(&sales, "customer_id")).await?;
    Ok(common::reply(Value::Array(
        sales
            .iter()
            .map(|o| {
                json!({
                    "id": o.val("id"),
                    "uuid": o.val("uuid"),
                    "tracking": o.val("tracking"),
                    "customer": o.opt_i64("customer_id").and_then(|c| customers.get(&c)).cloned().unwrap_or(Value::Null),
                    "service_table": opt_pos_table(o.opt_i64("table_id").and_then(|t| tables.get(&t))),
                    "pickup_point": opt_pos_pickup(&s, o.opt_i64("pickup_point_id").and_then(|p| pickups.get(&p))),
                    "payable_after_all": o.val("payable_after_all"),
                    "order_type": o.val("order_type"),
                    "progress": o.val("progress"),
                    "created_at": d(&s, o, "created_at"),
                    "updated_at": d(&s, o, "updated_at"),
                })
            })
            .collect(),
    )))
}

/* -------------------------------------------------- guest room stays */

async fn check_in(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    user.require(&["pos_portal", "manage_reservations"])?;
    let Some(tracking) = input.str("tracking").filter(|t| !t.trim().is_empty()) else {
        return Err(AppError::field("tracking", "The tracking field is required."));
    };
    let now = state.settings.get().await.now();
    let mut tx = state.db.begin().await?;
    let row = tx_row(
        &mut tx,
        "SELECT * FROM guest_room_reservations WHERE checkin_at IS NULL AND checkout_at IS NULL AND tracking = ? ORDER BY id LIMIT 1 FOR UPDATE",
        vec![tracking.into()],
    )
    .await?;
    let Some(r) = row else {
        return Err(AppError::unprocessable("No record found! It might have already been checked in"));
    };
    tx_exec(
        &mut tx,
        "UPDATE guest_room_reservations SET checkin_at = ?, updated_at = ? WHERE id = ?",
        vec![now.into(), now.into(), r.i64("id").into()],
    )
    .await?;
    tx.commit().await?;
    let list = common::checked_in_reservations(&state).await?;
    activity::log(&state, &user, &headers, &state.t("Guest room reservation checked in successfully").await, Some(&r.str("tracking")))
        .await;
    Ok(common::reply(json!({ "message": state.t("Checked in successfully").await, "reservations": list })))
}

async fn reservation_checkout(
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    input: Input,
) -> AppResult<Json<Value>> {
    user.require(&["manage_reservations", "pos_portal"])?;
    let mut q = Sql::new("SELECT * FROM guest_room_reservations WHERE uuid = ?");
    q.args.push(uuid.into());
    let r = q.fetch_optional(&state.db).await?.ok_or_else(AppError::not_found)?;

    let mut errors = Errors::default();
    if input.present("payments") && !input.val("payments").is_array() && !input.val("payments").is_object() {
        errors.add("payments", "The payments must be an array");
    }
    require_fields(&input, &mut errors, &["payment_cleared"]);
    errors.check()?;
    if r.opt_str("checkout_at").is_some() {
        return Err(AppError::unprocessable("Customer has already checkedout successfully"));
    }
    let s = state.settings.get().await;
    let now = s.now();
    let mut sets: Vec<&str> = Vec::new();
    let mut args: Vec<Arg> = Vec::new();
    if input.present("payments") {
        sets.push("payments = ?");
        args.push(match input.val("payments") {
            Value::Null => Arg::Null,
            v => Arg::Str(php::json_encode(&v)),
        });
    }
    sets.push("payment_cleared = ?");
    args.push(Arg::Int(crate::util::truthy(&input.val("payment_cleared")) as i64));
    for k in ["note", "staff_note"] {
        if input.present(k) {
            sets.push(if k == "note" { "note = ?" } else { "staff_note = ?" });
            args.push(match input.val(k) {
                Value::Null => Arg::Null,
                Value::String(t) => Arg::Str(t.chars().take(65535).collect()),
                other => Arg::Str(php::number_string(&other).unwrap_or_default()),
            });
        }
    }
    let finishing = php::truthy(&input.val("checkout_process"));
    if finishing {
        activity::log(&state, &user, &headers, &state.t("Guest room reservation checked out successfully").await, Some(&r.str("tracking")))
            .await;
        sets.push("checkout_at = ?");
        args.push(now.into());
    }
    sets.push("updated_at = ?");
    args.push(now.into());
    args.push(r.i64("id").into());
    let mut tx = state.db.begin().await?;
    let locked =
        tx_row(&mut tx, "SELECT checkout_at FROM guest_room_reservations WHERE id = ? FOR UPDATE", vec![r.i64("id").into()]).await?;
    if locked.map(|l| l.opt_str("checkout_at").is_some()).unwrap_or(true) {
        return Err(AppError::unprocessable("Customer has already checkedout successfully"));
    }
    tx_exec(&mut tx, &format!("UPDATE guest_room_reservations SET {} WHERE id = ?", sets.join(", ")), args).await?;
    tx.commit().await?;
    activity::log(&state, &user, &headers, &state.t("Guest room reservation updated successfully").await, Some(&r.str("tracking"))).await;
    Ok(common::reply(json!({ "message": state.t("Order information updated successfully").await })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kitchen_only_changes_ready_flags() {
        let stored = vec![
            json!({"cart_uuid": "a", "name": "Soup", "price": 5, "qty": 1, "is_ready": false}),
            json!({"cart_uuid": "b", "name": "Tea", "price": 2, "qty": 2, "is_ready": false}),
            json!({"name": "Old line", "price": 1, "qty": 1, "is_ready": false}),
        ];
        let sent = vec![
            json!({"cart_uuid": "b", "name": "Free tea", "price": 0, "qty": 50, "is_ready": true}),
            json!({"cart_uuid": "a", "name": "Soup", "price": 0, "is_ready": false}),
            json!({"name": "x", "price": 0, "is_ready": "1"}),
            json!({"cart_uuid": "c", "name": "Extra", "price": 9, "is_ready": true}),
        ];
        let merged = merge_ready(&stored, &sent);
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0], stored[0]);
        assert_eq!(merged[1], json!({"cart_uuid": "b", "name": "Tea", "price": 2, "qty": 2, "is_ready": true}));
        assert_eq!(merged[2]["is_ready"], json!(true));
        assert_eq!(merged[2]["price"], json!(1));
    }

    #[test]
    fn checkout_adjustments() {
        assert_eq!(adjustment_error(Some(10.0), true, Some(1.0), Some(0.0)), None);
        assert_eq!(adjustment_error(Some(150.0), false, Some(150.0), Some(2.0)), None);
        assert_eq!(adjustment_error(Some(101.0), true, Some(1.0), Some(0.0)), Some("discount_rate"));
        assert_eq!(adjustment_error(Some(-1.0), false, Some(0.0), Some(0.0)), Some("discount_rate"));
        assert_eq!(adjustment_error(None, false, Some(0.0), Some(0.0)), Some("discount_rate"));
        assert_eq!(adjustment_error(Some(0.0), false, Some(-5.0), Some(0.0)), Some("discount_amount"));
        assert_eq!(adjustment_error(Some(0.0), false, Some(0.0), Some(-1.0)), Some("tip_amount"));
        assert_eq!(adjustment_error(Some(0.0), false, Some(0.0), None), Some("tip_amount"));
    }

    #[test]
    fn totals_must_match() {
        assert!(total_matches(Some(12.34), 12.34));
        assert!(total_matches(Some(12.35), 12.34));
        assert!(!total_matches(Some(12.36), 12.34));
        assert!(!total_matches(Some(0.0), 12.34));
        assert!(!total_matches(None, 12.34));
    }

    #[test]
    fn cancel_transitions() {
        assert_eq!(cancel_change(false, true), CancelChange::Cancel);
        assert_eq!(cancel_change(true, false), CancelChange::Restore);
        assert_eq!(cancel_change(true, true), CancelChange::None);
        assert_eq!(cancel_change(false, false), CancelChange::None);
    }
}
