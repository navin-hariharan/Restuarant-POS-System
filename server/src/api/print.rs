//! Data for printed receipts: a sale and a guest room stay.

use super::pos::common::{
    self, bool_col, by_ids, customer_basic, d, json_col, load_pos_customers, load_staff, opt_pos_pickup, opt_pos_table, sale_by_uuid,
};
use crate::{
    auth::AuthUser,
    db::RowExt,
    error::{AppError, AppResult},
    query::Sql,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use serde_json::{json, Map, Value};

pub fn router() -> Router<AppState> {
    Router::new().route("/pos/sale/{sale}", get(sale)).route("/pos/print-guest-room-reserations/{reservation}", get(reservation))
}

/// Order type title shown on receipts.
async fn type_title(state: &AppState, key: &str) -> Value {
    let title = match key {
        "dining" => tr!("Dining"),
        "pickup" => tr!("Pickup"),
        "dilivery" => tr!("Delivery"),
        "roomservice" => tr!("Room Service"),
        _ => return Value::Null,
    };
    Value::from(state.t(title).await)
}

async fn sale(State(state): State<AppState>, user: AuthUser, Path(uuid): Path<String>) -> AppResult<Json<Value>> {
    user.require(&["pos_portal", "manage_sales", "kitchen_portal"])?;
    let o = sale_by_uuid(&state.db, &uuid).await?;
    let s = state.settings.get().await;
    let pickup = by_ids(&state.db, "pickup_points", o.opt_i64("pickup_point_id")).await?;
    let table = by_ids(&state.db, "service_tables", o.opt_i64("table_id")).await?;
    let taker = load_staff(&state, o.opt_i64("order_taker_id")).await?.into_values().next().unwrap_or(Value::Null);
    let customer = load_pos_customers(&state, o.opt_i64("customer_id")).await?.into_values().next().unwrap_or(Value::Null);
    Ok(common::reply(json!({
        "id": o.val("id"),
        "uuid": o.val("uuid"),
        "tracking": o.val("tracking"),
        "items": json_col(&o, "items"),
        "cart_total_price": o.val("cart_total_price"),
        "cart_total_cost": o.val("cart_total_cost"),
        "payable_after_all": o.val("payable_after_all"),
        "discount_rate": o.val("discount_rate"),
        "discount_amount": o.val("discount_amount"),
        "profit_after_all": o.val("profit_after_all"),
        "order_type": type_title(&state, &o.str("order_type")).await,
        "tax": json_col(&o, "tax"),
        "pickup_point": opt_pos_pickup(&s, pickup.values().next()),
        "taker": taker,
        "tax_amount": o.val("tax_amount"),
        "customer": customer,
        "table": opt_pos_table(table.values().next()),
        "shipping_address": o.val("shipping_address"),
        "is_cancelled": bool_col(&o, "is_cancelled"),
        "took_at": o.val("took_at"),
        "tip_amount": o.val("tip_amount"),
        "progress": o.val("progress"),
        "is_item_based_taxation": bool_col(&o, "is_item_based_taxation"),
        "created_at": d(&s, &o, "updated_at"),
        "updated_at": d(&s, &o, "updated_at"),
    })))
}

async fn reservation(State(state): State<AppState>, user: AuthUser, Path(uuid): Path<String>) -> AppResult<Json<Value>> {
    user.require(&["pos_portal", "manage_reservations"])?;
    let mut q = Sql::new("SELECT * FROM guest_room_reservations WHERE uuid = ?");
    q.args.push(uuid.into());
    let r = q.fetch_optional(&state.db).await?.ok_or_else(AppError::not_found)?;
    let s = state.settings.get().await;
    let rows = vec![r.clone()];
    let parts = common::reservation_parts(&state, &s, &rows).await?;
    let source = by_ids(&state.db, "booking_sources", r.opt_i64("booking_source_id")).await?;
    let status = by_ids(&state.db, "reservation_statuses", r.opt_i64("reservation_status_id")).await?;
    let titled = |row: Option<&common::Row>| {
        row.map(|x| json!({ "id": x.val("id"), "title": x.val("title"), "created_at": d(&s, x, "created_at"), "updated_at": d(&s, x, "updated_at") }))
            .unwrap_or(Value::Null)
    };
    let id = r.i64("id");
    let orders: Vec<Value> = parts
        .sales
        .get(&id)
        .map(|list| {
            list.rows
                .iter()
                .map(|o| json!({ "id": o.val("id"), "tracking": o.val("tracking"), "items": json_col(o, "items"), "created_at": d(&s, o, "updated_at"), "updated_at": d(&s, o, "updated_at") }))
                .collect()
        })
        .unwrap_or_default();
    let mut m = Map::new();
    let mut put = |k: &str, v: Value| {
        m.insert(k.to_string(), v);
    };
    put("id", r.val("id"));
    put("uuid", r.val("uuid"));
    put("tracking", r.val("tracking"));
    put("customer", r.opt_i64("customer_id").and_then(|c| parts.customers.get(&c)).map(|c| customer_basic(&s, c)).unwrap_or(Value::Null));
    put("customer_id", r.val("customer_id"));
    put("booking_source", titled(source.values().next()));
    put("booking_source_id", r.val("booking_source_id"));
    put("reservation_status", titled(status.values().next()));
    put("reservation_status_id", r.val("reservation_status_id"));
    put("guest_room", r.opt_i64("guest_room_id").and_then(|g| parts.rooms.get(&g)).cloned().unwrap_or(Value::Null));
    put("guest_room_id", r.val("guest_room_id"));
    put("payment_cleared", bool_col(&r, "payment_cleared"));
    put("tax_amount", r.val("tax_amount"));
    put("note", r.val("note"));
    put("staff_note", r.val("staff_note"));
    put("total_room_service_charges", r.val("total_room_service_charges"));
    for k in ["reserved_at_date", "reserved_at_time", "reserved_till_date", "reserved_till_time"] {
        put(k, r.val(k));
    }
    put("tax", json_col(&r, "tax"));
    put("is_charge_per_use", bool_col(&r, "is_charge_per_use"));
    put("reservation_hours", r.val("reservation_hours"));
    put("sub_total", r.val("sub_total"));
    put("checkin_at", r.val("checkin_at"));
    for (k, v) in common::reservation_sales_fields(&parts, id) {
        put(k, v);
    }
    put("orders", Value::Array(orders));
    put(
        "payments",
        match json_col(&r, "payments") {
            Value::Null => json!([]),
            v => v,
        },
    );
    put("payment_status", bool_col(&r, "payment_cleared"));
    put("checkout_at", r.val("checkout_at"));
    put("created_at", d(&s, &r, "updated_at"));
    put("updated_at", d(&s, &r, "updated_at"));
    Ok(common::reply(Value::Object(m)))
}
