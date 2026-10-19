//! Room reservations (admin side): guest rooms, booking sources, reservation
//! statuses and the reservations themselves.
//!
//! These screens exist only while room reservations are enabled (settings
//! column `disable_room_reservations` = 1 means ENABLED). While the mode is
//! off every route here answers like an unknown route, before sign-in is
//! checked. `room-reservations-filters` is always available.

use super::customers::customer_json;
use super::records::{self, filled, Col, Row};
use super::expenses::exists;
use super::taxes::pos_tax_json;
use crate::{
    activity,
    auth::AuthUser,
    db::RowExt,
    error::{AppError, AppResult, Errors},
    input::Input,
    query::{paged, Arg, Sql},
    settings::Settings,
    state::AppState,
};
use axum::{
    extract::{FromRequestParts, OriginalUri, Path, State},
    http::{request::Parts, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get},
    Json, Router,
};
use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, NaiveTime, TimeZone};
use serde_json::{json, Value};
use std::collections::HashMap;

pub fn router() -> Router<AppState> {
    let demo = || axum::middleware::from_fn(crate::middleware::demo_mode);
    Router::new()
        .route("/admin/room-reservations-filters", get(filters))
        .route("/admin/guest-room-reservations", get(reservation_index).post(reservation_store))
        .route(
            "/admin/guest-room-reservations/{reservation}",
            get(reservation_show).put(reservation_update).patch(reservation_update).delete(reservation_destroy),
        )
        .route("/admin/guest-rooms", get(room_index).post(room_store))
        .route("/admin/guest-rooms/{guest_room}", get(room_show))
        .route("/admin/booking-sources", get(source_index).post(source_store))
        .route("/admin/booking-sources/{booking_source}", get(source_show).put(source_update).patch(source_update))
        .route("/admin/reservation-statuses", get(status_index).post(status_store))
        .route("/admin/reservation-statuses/{reservation_status}", get(status_show).put(status_update).patch(status_update))
        .merge(
            Router::new()
                .route("/admin/guest-rooms/{guest_room}", delete(room_destroy).put(room_update).patch(room_update))
                .route("/admin/booking-sources/{booking_source}", delete(source_destroy))
                .route("/admin/reservation-statuses/{reservation_status}", delete(status_destroy))
                .route_layer(demo()),
        )
}

// ---------------------------------------------------------------- mode gate

/// Passes only while room reservations are enabled; otherwise the request
/// gets the unknown-route answer (put it before `AuthUser`).
pub struct RoomsEnabled;

impl FromRequestParts<AppState> for RoomsEnabled {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        if state.settings.get().await.modes().room_reservations {
            return Ok(RoomsEnabled);
        }
        let path = parts.extensions.get::<OriginalUri>().map(|u| u.0.path().to_string()).unwrap_or_else(|| parts.uri.path().to_string());
        let path = path.trim_start_matches('/');
        Err((StatusCode::NOT_FOUND, Json(json!({ "message": format!("The route {path} could not be found.") }))).into_response())
    }
}

// ---------------------------------------------------------------- resources

fn titled_json(s: &Settings, r: &Row) -> Value {
    json!({
        "id": r.get("id"),
        "title": r.get("title"),
        "created_at": records::date(s, r, "created_at"),
        "updated_at": records::date(s, r, "updated_at"),
    })
}

/// GuestRoomResource (`slots` = reservations of the room)
fn room_json(s: &Settings, r: &Row, slots: &[Row]) -> Value {
    let reserved: Vec<Value> = slots
        .iter()
        .map(|x| {
            json!({
                "reserved_at_date": x.get("reserved_at_date"),
                "reserved_at_time": x.get("reserved_at_time"),
                "reserved_till_date": x.get("reserved_till_date"),
                "reserved_till_time": x.get("reserved_till_time"),
            })
        })
        .collect();
    json!({
        "id": r.get("id"),
        "room_name": r.get("room_name"),
        "capactity": r.get("capactity"),
        "per_hour_charges": r.get("per_hour_charges"),
        "per_use_charges": r.get("per_use_charges"),
        "layout": r.get("layout"),
        "reserved_slots": reserved,
        "created_at": records::date(s, r, "created_at"),
        "updated_at": records::date(s, r, "updated_at"),
    })
}

/// Reservation date slots of the given rooms, by room id.
async fn slots_for(state: &AppState, room_ids: Vec<i64>) -> AppResult<HashMap<i64, Vec<Row>>> {
    let mut map: HashMap<i64, Vec<Row>> = HashMap::new();
    if room_ids.is_empty() {
        return Ok(map);
    }
    let mut q = Sql::new(
        "SELECT id, guest_room_id, reserved_at_date, reserved_at_time, reserved_till_date, reserved_till_time FROM guest_room_reservations WHERE 1=1",
    );
    q.and_in("guest_room_id", room_ids);
    q.push(" ORDER BY id");
    for r in q.fetch_all(&state.db).await? {
        map.entry(r.i64("guest_room_id")).or_default().push(r);
    }
    Ok(map)
}

async fn rooms_json(state: &AppState, s: &Settings, rooms: &[Row]) -> AppResult<Vec<Value>> {
    let slots = slots_for(state, rooms.iter().map(|r| r.i64("id")).collect()).await?;
    Ok(rooms.iter().map(|r| room_json(s, r, slots.get(&r.i64("id")).map(Vec::as_slice).unwrap_or(&[]))).collect())
}

async fn rows_by_id(state: &AppState, table: &'static str, ids: Vec<i64>) -> AppResult<HashMap<i64, Row>> {
    let mut ids = ids;
    ids.sort_unstable();
    ids.dedup();
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let mut q = Sql::new(format!("SELECT * FROM `{table}` WHERE 1=1"));
    q.and_in("id", ids);
    Ok(q.fetch_all(&state.db).await?.into_iter().map(|r| (r.i64("id"), r)).collect())
}

/// Customers, sources, statuses and rooms (with their slots) of some reservations.
struct Related {
    customers: HashMap<i64, Row>,
    sources: HashMap<i64, Row>,
    statuses: HashMap<i64, Row>,
    rooms: HashMap<i64, Value>,
}

async fn related(state: &AppState, s: &Settings, rows: &[Row]) -> AppResult<Related> {
    let ids = |key: &str| rows.iter().filter_map(|r| r.opt_i64(key)).collect::<Vec<i64>>();
    let rooms = rows_by_id(state, "guest_rooms", ids("guest_room_id")).await?;
    let room_rows: Vec<Row> = rooms.values().cloned().collect();
    let room_values = rooms_json(state, s, &room_rows).await?;
    Ok(Related {
        customers: rows_by_id(state, "customers", ids("customer_id")).await?,
        sources: rows_by_id(state, "booking_sources", ids("booking_source_id")).await?,
        statuses: rows_by_id(state, "reservation_statuses", ids("reservation_status_id")).await?,
        rooms: room_rows.iter().map(|r| r.i64("id")).zip(room_values).collect(),
    })
}

fn pick<'a>(map: &'a HashMap<i64, Row>, r: &Row, key: &str) -> Option<&'a Row> {
    r.opt_i64(key).and_then(|id| map.get(&id))
}

/// GuestRoomReservationResource (list rows)
fn reservation_json(s: &Settings, r: &Row, rel: &Related) -> Value {
    json!({
        "id": r.get("id"),
        "uuid": r.get("uuid"),
        "tracking": r.get("tracking"),
        "customer": pick(&rel.customers, r, "customer_id").map(|c| customer_json(s, c)),
        "booking_source": pick(&rel.sources, r, "booking_source_id").map(|x| titled_json(s, x)),
        "reservation_status": pick(&rel.statuses, r, "reservation_status_id").map(|x| titled_json(s, x)),
        "guest_room": r.opt_i64("guest_room_id").and_then(|id| rel.rooms.get(&id)).cloned(),
        "payment_cleared": r.bool("payment_cleared"),
        "tax_amount": records::num(r, "tax_amount"),
        "total_room_service_charges": records::num(r, "total_room_service_charges"),
        "reserved_at_date": r.get("reserved_at_date"),
        "reserved_at_time": r.get("reserved_at_time"),
        "checkin_at": r.get("checkin_at"),
        "checkout_at": r.get("checkout_at"),
        "reservation_hours": r.get("reservation_hours"),
        "sub_total": r.get("sub_total"),
        // the previous API showed the update time in both
        "created_at": records::date(s, r, "updated_at"),
        "updated_at": records::date(s, r, "updated_at"),
    })
}

/// PosCustomerResource: the customer with their 10 latest orders.
async fn pos_customer_json(state: &AppState, s: &Settings, c: &Row) -> AppResult<Value> {
    let sales = sqlx::query("SELECT id, uuid, tracking, updated_at FROM sales WHERE customer_id = ? ORDER BY created_at DESC, id DESC LIMIT 10")
        .bind(c.i64("id"))
        .fetch_all(&state.db)
        .await?;
    let now = s.now();
    let history: Vec<Value> = crate::db::rows_json(&sales)
        .iter()
        .map(|x| {
            let ago = x.opt_str("updated_at").and_then(|d| crate::datefmt::parse(&d)).map(|d| human_diff(d, now));
            json!({
                "id": x.get("id"),
                "uuid": x.get("uuid"),
                "tracking": x.get("tracking"),
                "created_at": ago,
                "updated_at": records::date(s, x, "updated_at"),
            })
        })
        .collect();
    let full_name = format!("{} {} {}", c.str("name"), c.str("email"), c.str("phone"));
    let shipping = match records::json_col(c, "shipping_addresses") {
        Value::Null => json!([]),
        v => v,
    };
    Ok(json!({
        "id": c.get("id"),
        "uuid": c.get("uuid"),
        "full_name": full_name.trim_matches([' ', '\t', '\n', '\r', '\0', '\x0b']),
        "name": c.get("name"),
        "email": c.get("email"),
        "address": c.get("address"),
        "phone": c.get("phone"),
        "shipping_addresses": shipping,
        "history": history,
        "created_at": records::date(s, c, "created_at"),
        "updated_at": records::date(s, c, "updated_at"),
    }))
}

/// GuestRoomReservationDetailsResource
async fn reservation_details(state: &AppState, s: &Settings, r: &Row) -> AppResult<Value> {
    let rel = related(state, s, std::slice::from_ref(r)).await?;
    let customer = match pick(&rel.customers, r, "customer_id") {
        Some(c) => Some(pos_customer_json(state, s, c).await?),
        None => None,
    };
    let sales = sqlx::query("SELECT cart_total_items, tax_amount, discount_amount, payable_after_all FROM sales WHERE guest_room_reservation_id = ? ORDER BY id")
        .bind(r.i64("id"))
        .fetch_all(&state.db)
        .await?;
    let sales = crate::db::rows_json(&sales);
    let sum = |key: &str| crate::util::json_num(sales.iter().fold(0.0, |acc, x| acc + x.f64(key)));
    let payments = match records::json_col(r, "payments") {
        Value::Null => json!([]),
        v => v,
    };
    Ok(json!({
        "id": r.get("id"),
        "uuid": r.get("uuid"),
        "tracking": r.get("tracking"),
        "customer": customer,
        "customer_id": r.get("customer_id"),
        "booking_source": pick(&rel.sources, r, "booking_source_id").map(|x| titled_json(s, x)),
        "booking_source_id": r.get("booking_source_id"),
        "reservation_status": pick(&rel.statuses, r, "reservation_status_id").map(|x| titled_json(s, x)),
        "reservation_status_id": r.get("reservation_status_id"),
        "guest_room": r.opt_i64("guest_room_id").and_then(|id| rel.rooms.get(&id)).cloned(),
        "guest_room_id": r.get("guest_room_id"),
        "payment_cleared": r.bool("payment_cleared"),
        "payments": payments,
        "tax_amount": records::num(r, "tax_amount"),
        "note": r.get("note"),
        "staff_note": r.get("staff_note"),
        "total_room_service_charges": records::num(r, "total_room_service_charges"),
        "charges": r.get("charges"),
        "reserved_at_date": r.get("reserved_at_date"),
        "reserved_at_time": r.get("reserved_at_time"),
        "reserved_till_date": r.get("reserved_till_date"),
        "reserved_till_time": r.get("reserved_till_time"),
        "tax": records::json_col(r, "tax"),
        "reservation_hours": r.get("reservation_hours"),
        "sub_total": r.get("sub_total"),
        "checkin_at": r.get("checkin_at"),
        "sales_tax_amount": sum("tax_amount"),
        "sale_discount_amount": sum("discount_amount"),
        "sales_payable_amount": sum("payable_after_all"),
        "sales_items": sum("cart_total_items"),
        "sales_orders": sales.len(),
        "checkout_at": r.get("checkout_at"),
        "is_charge_per_use": r.bool("is_charge_per_use"),
        "created_at": records::date(s, r, "updated_at"),
        "updated_at": records::date(s, r, "updated_at"),
    }))
}

// ---------------------------------------------------------------- filters

async fn filters(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(&["manage_reservations"])?;
    let s = state.settings.get().await;
    let all = |table: &str| Sql::new(format!("SELECT * FROM `{table}`"));
    let customers = all("customers").fetch_all(&state.db).await?;
    let statuses = all("reservation_statuses").fetch_all(&state.db).await?;
    let sources = all("booking_sources").fetch_all(&state.db).await?;
    let rooms = all("guest_rooms").fetch_all(&state.db).await?;
    let taxes = all("taxes").fetch_all(&state.db).await?;
    Ok(Json(json!({
        "customers": customers.iter().map(|c| customer_json(&s, c)).collect::<Vec<_>>(),
        "statuses": statuses.iter().map(|x| titled_json(&s, x)).collect::<Vec<_>>(),
        "sources": sources.iter().map(|x| titled_json(&s, x)).collect::<Vec<_>>(),
        "rooms": rooms_json(&state, &s, &rooms).await?,
        "taxes": taxes.iter().map(|t| pos_tax_json(&s, t)).collect::<Vec<_>>(),
    })))
}

// ---------------------------------------------------------------- titled lists

/// Booking sources and reservation statuses share one shape.
#[derive(Clone, Copy)]
struct Titled {
    table: &'static str,
    permission: &'static str,
    key: &'static str,
    added: &'static str,
    updated: &'static str,
    removed: &'static str,
    in_use: &'static str,
    fk: &'static str,
}

const SOURCES: Titled = Titled {
    table: "booking_sources",
    permission: "manage_booking_sources",
    key: "source",
    added: tr!("New booking source added successfully"),
    updated: tr!("Booking source updated successfully"),
    removed: tr!("Booking source removed successfully"),
    in_use: tr!("Unable to remove booking source information is being used"),
    fk: "booking_source_id",
};

const STATUSES: Titled = Titled {
    table: "reservation_statuses",
    permission: "manage_reservation_statuses",
    key: "status",
    added: tr!("New reservation status added successfully"),
    updated: tr!("Reservation status updated successfully"),
    removed: tr!("Reservation status removed successfully"),
    in_use: tr!("Unable to remove reservation status information is being used"),
    fk: "reservation_status_id",
};

async fn titled_index(state: &AppState, user: &AuthUser, t: Titled) -> AppResult<Json<Value>> {
    user.require(&[t.permission])?;
    let rows = Sql::new(format!("SELECT * FROM `{}` ORDER BY created_at DESC", t.table)).fetch_all(&state.db).await?;
    let s = state.settings.get().await;
    Ok(Json(Value::Array(rows.iter().map(|r| titled_json(&s, r)).collect())))
}

async fn titled_validate(state: &AppState, t: Titled, input: &Input, ignore: Option<i64>) -> AppResult<Vec<Col>> {
    let mut e = Errors::default();
    let title = input.val("title");
    if !filled(Some(&title)) {
        e.add("title", tr!("The title field is required."));
    } else {
        if records::char_len(&title) > 255 {
            e.add("title", tr!("The title may not be greater than 255 characters."));
        }
        if records::taken(state, t.table, "title", &title, ignore).await? {
            e.add("title", tr!("The title has already been taken."));
        }
    }
    e.check()?;
    Ok(vec![Col::plain("title", title)])
}

async fn titled_store(state: &AppState, user: &AuthUser, headers: &HeaderMap, t: Titled, input: Input) -> AppResult<Json<Value>> {
    user.require(&[t.permission])?;
    let cols = titled_validate(state, t, &input, None).await?;
    let now = state.settings.get().await.now();
    let id = records::insert(&state.db, t.table, &cols, now).await?;
    activity::log(state, user, headers, &state.t(t.added).await, None).await;
    let mut out = serde_json::Map::new();
    out.insert("message".into(), state.t("Data saved successfully").await.into());
    out.insert(t.key.into(), id.into());
    Ok(Json(Value::Object(out)))
}

async fn titled_show(state: &AppState, user: &AuthUser, t: Titled, id: &str) -> AppResult<Json<Value>> {
    user.require(&[t.permission])?;
    let row = records::find(state, t.table, id).await?;
    let s = state.settings.get().await;
    Ok(Json(titled_json(&s, &row)))
}

async fn titled_update(state: &AppState, user: &AuthUser, headers: &HeaderMap, t: Titled, id: &str, input: Input) -> AppResult<Json<Value>> {
    user.require(&[t.permission])?;
    let row = records::find(state, t.table, id).await?;
    let cols = titled_validate(state, t, &input, Some(row.i64("id"))).await?;
    let now = state.settings.get().await.now();
    records::update(&state.db, t.table, &row, &cols, now).await?;
    activity::log(state, user, headers, &state.t(t.updated).await, None).await;
    let mut out = serde_json::Map::new();
    out.insert("message".into(), state.t("Data updated successfully").await.into());
    out.insert(t.key.into(), row.i64("id").into());
    Ok(Json(Value::Object(out)))
}

async fn titled_destroy(state: &AppState, user: &AuthUser, headers: &HeaderMap, t: Titled, id: &str) -> AppResult<Json<Value>> {
    user.require(&[t.permission])?;
    let row = records::find(state, t.table, id).await?;
    let id = row.i64("id");
    if records::count_where(state, "guest_room_reservations", t.fk, id).await? > 0 {
        return Err(AppError::unprocessable(t.in_use));
    }
    sqlx::query(&format!("DELETE FROM `{}` WHERE id = ?", t.table)).bind(id).execute(&state.db).await?;
    activity::log(state, user, headers, &state.t(t.removed).await, None).await;
    Ok(Json(json!({ "message": state.t("Data removed successfully").await })))
}

async fn source_index(_: RoomsEnabled, State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    titled_index(&state, &user, SOURCES).await
}
async fn source_store(_: RoomsEnabled, State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    titled_store(&state, &user, &headers, SOURCES, input).await
}
async fn source_show(_: RoomsEnabled, State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<Json<Value>> {
    titled_show(&state, &user, SOURCES, &id).await
}
async fn source_update(
    _: RoomsEnabled,
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
    input: Input,
) -> AppResult<Json<Value>> {
    titled_update(&state, &user, &headers, SOURCES, &id, input).await
}
async fn source_destroy(_: RoomsEnabled, State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(id): Path<String>) -> AppResult<Json<Value>> {
    titled_destroy(&state, &user, &headers, SOURCES, &id).await
}

async fn status_index(_: RoomsEnabled, State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    titled_index(&state, &user, STATUSES).await
}
async fn status_store(_: RoomsEnabled, State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    titled_store(&state, &user, &headers, STATUSES, input).await
}
async fn status_show(_: RoomsEnabled, State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<Json<Value>> {
    titled_show(&state, &user, STATUSES, &id).await
}
async fn status_update(
    _: RoomsEnabled,
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
    input: Input,
) -> AppResult<Json<Value>> {
    titled_update(&state, &user, &headers, STATUSES, &id, input).await
}
async fn status_destroy(_: RoomsEnabled, State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(id): Path<String>) -> AppResult<Json<Value>> {
    titled_destroy(&state, &user, &headers, STATUSES, &id).await
}

// ---------------------------------------------------------------- guest rooms

const ROOMS: &str = "manage_guest_rooms";

async fn room_index(_: RoomsEnabled, State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(&[ROOMS])?;
    let rows = Sql::new("SELECT * FROM guest_rooms ORDER BY created_at DESC").fetch_all(&state.db).await?;
    let s = state.settings.get().await;
    Ok(Json(Value::Array(rooms_json(&state, &s, &rows).await?)))
}

async fn room_validate(state: &AppState, input: &Input, ignore: Option<i64>) -> AppResult<Vec<Col>> {
    let mut e = Errors::default();
    let name = input.val("room_name");
    if !filled(Some(&name)) {
        e.add("room_name", tr!("The room name field is required."));
    } else {
        if records::char_len(&name) > 255 {
            e.add("room_name", tr!("The room name may not be greater than 255 characters."));
        }
        if records::taken(state, "guest_rooms", "room_name", &name, ignore).await? {
            e.add("room_name", tr!("The room name has already been taken."));
        }
    }
    if !filled(input.data.get("capactity")) {
        e.add("capactity", tr!("The capactity field is required."));
    }
    let hour = input.val("per_hour_charges");
    if !filled(Some(&hour)) {
        e.add("per_hour_charges", tr!("The per hour charges field is required."));
    } else if !records::is_numeric(&hour) {
        e.add("per_hour_charges", tr!("The per hour charges must be a number."));
    }
    let per_use = input.val("per_use_charges");
    if !filled(Some(&per_use)) {
        e.add("per_use_charges", tr!("The per use charges field is required."));
    } else if !records::is_numeric(&per_use) {
        e.add("per_use_charges", tr!("The per use charges must be a number."));
    }
    e.check()?;
    let mut cols = vec![
        Col::plain("room_name", name),
        Col::plain("capactity", input.val("capactity")),
        Col::plain("per_hour_charges", hour),
        Col::plain("per_use_charges", per_use),
    ];
    if input.present("layout") {
        cols.push(Col::plain("layout", input.val("layout")));
    }
    Ok(cols)
}

async fn room_store(_: RoomsEnabled, State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    user.require(&[ROOMS])?;
    let cols = room_validate(&state, &input, None).await?;
    let now = state.settings.get().await.now();
    let id = records::insert(&state.db, "guest_rooms", &cols, now).await?;
    activity::log(&state, &user, &headers, &state.t("New guest room added successfully").await, None).await;
    Ok(Json(json!({ "message": state.t("Data saved successfully").await, "guest_room": id })))
}

async fn room_show(_: RoomsEnabled, State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(&[ROOMS])?;
    let row = records::find(&state, "guest_rooms", &id).await?;
    let s = state.settings.get().await;
    let mut list = rooms_json(&state, &s, std::slice::from_ref(&row)).await?;
    Ok(Json(list.pop().unwrap_or(Value::Null)))
}

async fn room_update(
    _: RoomsEnabled,
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
    input: Input,
) -> AppResult<Json<Value>> {
    user.require(&[ROOMS])?;
    let row = records::find(&state, "guest_rooms", &id).await?;
    let cols = room_validate(&state, &input, Some(row.i64("id"))).await?;
    let now = state.settings.get().await.now();
    records::update(&state.db, "guest_rooms", &row, &cols, now).await?;
    activity::log(&state, &user, &headers, &state.t("Guest room information updated successfully").await, None).await;
    Ok(Json(json!({ "message": state.t("Data updated successfully").await })))
}

async fn room_destroy(_: RoomsEnabled, State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(&[ROOMS])?;
    let row = records::find(&state, "guest_rooms", &id).await?;
    let id = row.i64("id");
    if records::count_where(&state, "guest_room_reservations", "guest_room_id", id).await? > 0 {
        return Err(AppError::unprocessable("Unable to remove guest room information is being used"));
    }
    sqlx::query("DELETE FROM guest_rooms WHERE id = ?").bind(id).execute(&state.db).await?;
    activity::log(&state, &user, &headers, &state.t("Guest room removed successfully").await, None).await;
    Ok(Json(json!({ "message": state.t("Data removed successfully").await })))
}

// ---------------------------------------------------------------- reservations

const RESERVATIONS: &str = "manage_reservations";
const RESERVATION_SORT: [&str; 22] = [
    "id",
    "uuid",
    "tracking",
    "payment_cleared",
    "tax_amount",
    "total_room_service_charges",
    "booked_at",
    "reserved_at_date",
    "reserved_at_time",
    "reserved_till_date",
    "reserved_till_time",
    "reservation_status_id",
    "booking_source_id",
    "guest_room_id",
    "customer_id",
    "checkin_at",
    "checkout_at",
    "reservation_hours",
    "charges",
    "sub_total",
    "created_at",
    "updated_at",
];

async fn reservation_index(_: RoomsEnabled, State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(&[RESERVATIONS])?;
    let s = state.settings.get().await;
    let mut q = Sql::new("SELECT * FROM guest_room_reservations WHERE 1=1");
    if let Some(term) = input.opt_str("search") {
        q.and("tracking LIKE ?", s.search_pattern(&term));
    }
    for (keys, col) in [
        (["customer", "customer_id"], "customer_id"),
        (["guest_room", "guest_room_id"], "guest_room_id"),
        (["booking_source", "booking_source_id"], "booking_source_id"),
        (["reservation_status", "reservation_status_id"], "reservation_status_id"),
    ] {
        for key in keys {
            if let Some(v) = input.opt_str(key) {
                q.and(&format!("{col} = ?"), v);
            }
        }
    }
    let range = Range {
        duration: input.opt_str("duration"),
        start_date: input.opt_str("starting_date"),
        start_time: input.opt_str("starting_time"),
        end_date: input.opt_str("ending_date"),
        end_time: input.opt_str("ending_time"),
    };
    apply_duration(&mut q, &range, s.now(), s.tz());
    let (col, order) = input.sort(&RESERVATION_SORT, "created_at", "asc");
    q.push(&format!(" ORDER BY {} {order}", crate::db::ident(&col)));
    let (rows, pagination) = q.paginate(&state.db, input.page(10)).await?;
    let rel = related(&state, &s, &rows).await?;
    Ok(Json(paged(rows.iter().map(|r| reservation_json(&s, r, &rel)).collect(), pagination)))
}

/// Rules of the reservation form; returns the columns to write.
async fn reservation_validate(state: &AppState, input: &Input) -> AppResult<Vec<Col>> {
    let mut e = Errors::default();
    let required: [(&str, &str); 17] = [
        ("customer_id", tr!("The customer id field is required.")),
        ("guest_room_id", tr!("The guest room id field is required.")),
        ("booking_source_id", tr!("The booking source id field is required.")),
        ("reserved_at_date", tr!("The reserved at date field is required.")),
        ("reserved_at_time", tr!("The reserved at time field is required.")),
        ("reserved_till_date", tr!("The reserved till date field is required.")),
        ("reserved_till_time", tr!("The reserved till time field is required.")),
        ("reservation_status_id", tr!("The reservation status id field is required.")),
        ("tax", tr!("The tax field is required.")),
        ("payments", ""),
        ("tax_amount", tr!("The tax amount field is required.")),
        ("reservation_hours", tr!("The reservation hours field is required.")),
        ("charges", tr!("The charges field is required.")),
        ("is_charge_per_use", tr!("The is charge per use field is required.")),
        ("sub_total", tr!("The sub total field is required.")),
        ("total_room_service_charges", tr!("The total room service charges field is required.")),
        ("staff_note", ""),
    ];
    for (key, msg) in required {
        if msg.is_empty() {
            continue;
        }
        let v = input.data.get(key);
        if !filled(v) {
            e.add(key, msg);
            continue;
        }
        let v = v.cloned().unwrap_or(Value::Null);
        // Checks the previous API left to the database (which failed with a server error)
        match key {
            "customer_id" if !exists(state, "customers", &v).await? => e.add(key, tr!("The selected customer id is invalid.")),
            "guest_room_id" if !exists(state, "guest_rooms", &v).await? => e.add(key, tr!("The selected guest room id is invalid.")),
            "booking_source_id" if !exists(state, "booking_sources", &v).await? => e.add(key, tr!("The selected booking source id is invalid.")),
            "reservation_status_id" if !exists(state, "reservation_statuses", &v).await? => {
                e.add(key, tr!("The selected reservation status id is invalid."))
            }
            "tax" if !matches!(v, Value::Array(_) | Value::Object(_)) => e.add(key, tr!("The tax must be an array")),
            "tax_amount" if !records::is_numeric(&v) => e.add(key, tr!("The tax amount must be a number.")),
            "total_room_service_charges" if !records::is_numeric(&v) => e.add(key, tr!("The total room service charges must be a number.")),
            _ => {}
        }
    }
    e.check()?;

    let mut cols = Vec::new();
    for key in [
        "customer_id",
        "guest_room_id",
        "booking_source_id",
        "reserved_at_date",
        "reserved_at_time",
        "reserved_till_date",
        "reserved_till_time",
        "reservation_status_id",
    ] {
        cols.push(Col::plain(key, input.val(key)));
    }
    cols.push(Col::json("tax", input.val("tax")));
    if input.present("payments") {
        cols.push(Col::json("payments", input.val("payments")));
    }
    for key in ["tax_amount", "reservation_hours", "charges"] {
        cols.push(Col::plain(key, input.val(key)));
    }
    cols.push(Col::boolean("is_charge_per_use", input.val("is_charge_per_use")));
    cols.push(Col::plain("sub_total", input.val("sub_total")));
    for key in ["staff_note", "note"] {
        if input.present(key) {
            cols.push(Col::plain(key, input.val(key)));
        }
    }
    cols.push(Col::plain("total_room_service_charges", input.val("total_room_service_charges")));
    Ok(cols)
}

fn col_value<'a>(cols: &'a [Col], row: Option<&'a Row>, key: &str) -> Value {
    cols.iter().find(|c| c.name == key).map(|c| c.value.clone()).or_else(|| row.map(|r| r.val(key))).unwrap_or(Value::Null)
}

/// Another reservation of the same room overlapping the period (back-to-back stays are fine).
async fn overlaps(state: &AppState, cols: &[Col], row: Option<&Row>) -> AppResult<bool> {
    let v = |k: &str| Arg::from(col_value(cols, row, k));
    let mut q = Sql::new("SELECT COUNT(*) AS c FROM guest_room_reservations WHERE guest_room_id = ?");
    q.args.push(v("guest_room_id"));
    q.push_args(
        " AND TIMESTAMP(reserved_at_date, reserved_at_time) < TIMESTAMP(?, ?) AND TIMESTAMP(reserved_till_date, reserved_till_time) > TIMESTAMP(?, ?)",
        [v("reserved_till_date"), v("reserved_till_time"), v("reserved_at_date"), v("reserved_at_time")],
    );
    if let Some(r) = row {
        q.and("id <> ?", r.i64("id"));
    }
    Ok(q.scalar_f64(&state.db).await? > 0.0)
}

fn already_reserved() -> AppError {
    AppError::field("reserved_at_date", tr!("The selected date and time duration is already reserved."))
}

async fn reservation_store(_: RoomsEnabled, State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(&[RESERVATIONS])?;
    let mut cols = reservation_validate(&state, &input).await?;
    let s = state.settings.get().await;
    let now = s.now();
    let uuid = crate::util::uuid();
    cols.push(Col::plain("tracking", Value::from(chrono::Utc::now().timestamp().to_string())));
    cols.push(Col::plain("uuid", Value::from(uuid.clone())));
    if input.get("checkin_process").map(records::php_truthy).unwrap_or(false) {
        cols.push(Col::plain("checkin_at", Value::from(now.format("%Y-%m-%d %H:%M:%S").to_string())));
    }
    if overlaps(&state, &cols, None).await? {
        return Err(already_reserved());
    }
    records::insert(&state.db, "guest_room_reservations", &cols, now).await?;
    Ok(Json(json!({ "message": state.t("Data saved successfully").await, "reservation": uuid })))
}

async fn reservation_show(_: RoomsEnabled, State(state): State<AppState>, user: AuthUser, Path(uuid): Path<String>) -> AppResult<Json<Value>> {
    user.require(&[RESERVATIONS])?;
    let row = records::find_by(&state, "guest_room_reservations", "uuid", uuid).await?;
    let s = state.settings.get().await;
    Ok(Json(reservation_details(&state, &s, &row).await?))
}

async fn reservation_update(
    _: RoomsEnabled,
    State(state): State<AppState>,
    user: AuthUser,
    Path(uuid): Path<String>,
    input: Input,
) -> AppResult<Json<Value>> {
    user.require(&[RESERVATIONS])?;
    let row = records::find_by(&state, "guest_room_reservations", "uuid", uuid).await?;
    let mut cols = reservation_validate(&state, &input).await?;
    let now = state.settings.get().await.now();
    if input.get("checkin_process").map(records::php_truthy).unwrap_or(false) {
        cols.push(Col::plain("checkin_at", Value::from(now.format("%Y-%m-%d %H:%M:%S").to_string())));
    }
    if cols.iter().any(|c| c.changes(&row)) {
        if overlaps(&state, &cols, Some(&row)).await? {
            return Err(already_reserved());
        }
        records::update(&state.db, "guest_room_reservations", &row, &cols, now).await?;
    }
    Ok(Json(json!({ "message": state.t("Data updated successfully").await })))
}

async fn reservation_destroy(_: RoomsEnabled, State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(uuid): Path<String>) -> AppResult<Json<Value>> {
    user.require(&["manage_reservations_remove"])?;
    let row = records::find_by(&state, "guest_room_reservations", "uuid", uuid).await?;
    let id = row.i64("id");
    let sales: Vec<(i64, Option<String>)> = sqlx::query_as("SELECT CAST(id AS SIGNED), tracking FROM sales WHERE guest_room_reservation_id = ? ORDER BY id")
        .bind(id)
        .fetch_all(&state.db)
        .await?;
    let mut tx = state.db.begin().await?;
    sqlx::query("DELETE FROM sales WHERE guest_room_reservation_id = ?").bind(id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM guest_room_reservations WHERE id = ?").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    let msg = state.t("Sale order removed successfully").await;
    for (_, tracking) in &sales {
        activity::log(&state, &user, &headers, &msg, tracking.as_deref()).await;
    }
    Ok(Json(json!({ "message": state.t("Data removed successfully").await })))
}

// ---------------------------------------------------------------- periods

/// The period filter of the reservations list (`duration` plus optional dates).
struct Range {
    duration: Option<String>,
    start_date: Option<String>,
    start_time: Option<String>,
    end_date: Option<String>,
    end_time: Option<String>,
}

const SQL_DT: &str = "%Y-%m-%d %H:%M:%S";

fn norm_time(t: Option<&str>, default: &str) -> String {
    match t {
        Some(t) if t.len() == 5 && is_clock(t, 2) => format!("{t}:00"),
        Some(t) if t.len() == 8 && is_clock(t, 3) => t.to_string(),
        _ => default.to_string(),
    }
}

/// "HH:MM" (parts = 2) or "HH:MM:SS" (parts = 3), digits only
fn is_clock(t: &str, parts: usize) -> bool {
    let p: Vec<&str> = t.split(':').collect();
    p.len() == parts && p.iter().all(|x| x.len() == 2 && x.bytes().all(|b| b.is_ascii_digit()))
}

fn days_in_month(y: i32, m: u32) -> u32 {
    let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
    NaiveDate::from_ymd_opt(ny, nm, 1).and_then(|d| d.pred_opt()).map(|d| d.day()).unwrap_or(28)
}

/// Add months the way PHP does: a day past the end of the month runs into the next month.
fn add_months(dt: NaiveDateTime, months: i32) -> NaiveDateTime {
    let total = dt.year() * 12 + dt.month0() as i32 + months;
    let (y, m) = (total.div_euclid(12), total.rem_euclid(12) as u32 + 1);
    let dim = days_in_month(y, m);
    let base = NaiveDate::from_ymd_opt(y, m, dt.day().min(dim)).unwrap_or(dt.date());
    let extra = dt.day().saturating_sub(dim) as i64;
    (base + Duration::days(extra)).and_time(dt.time())
}

fn start_of_day(d: NaiveDate) -> NaiveDateTime {
    d.and_time(NaiveTime::MIN)
}

fn end_of_day(d: NaiveDate) -> NaiveDateTime {
    d.and_hms_opt(23, 59, 59).unwrap_or(start_of_day(d))
}

fn month_start(y: i32, m: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, 1).unwrap_or(NaiveDate::MIN)
}

/// The previous `weekday` strictly before `now`, at midnight.
fn previous(now: NaiveDateTime, weekday: chrono::Weekday) -> NaiveDateTime {
    let today = now.weekday().num_days_from_monday() as i64;
    let target = weekday.num_days_from_monday() as i64;
    let back = match (today - target).rem_euclid(7) {
        0 => 7,
        n => n,
    };
    start_of_day(now.date() - Duration::days(back))
}

fn apply_duration(q: &mut Sql, r: &Range, now: NaiveDateTime, tz: chrono_tz::Tz) {
    let epoch = tz.timestamp_opt(0, 0).single().map(|d| d.naive_local()).unwrap_or_default();
    let st = norm_time(r.start_time.as_deref(), "00:00:00");
    let et = norm_time(r.end_time.as_deref(), "23:59:59");
    let parse = |d: &Option<String>, t: &str, default: NaiveDateTime| match d {
        Some(d) => NaiveDateTime::parse_from_str(&format!("{d} {t}"), SQL_DT).ok(),
        None => Some(default),
    };
    let (start, end) = match (parse(&r.start_date, &st, epoch), parse(&r.end_date, &et, now)) {
        (Some(a), Some(b)) => (a, b),
        _ => (epoch, now),
    };
    let between = |q: &mut Sql, a: NaiveDateTime, b: NaiveDateTime| {
        q.push_args(" AND created_at BETWEEN ? AND ?", [a.format(SQL_DT).to_string(), b.format(SQL_DT).to_string()]);
    };
    let year_month = |q: &mut Sql, y: i32, m: Option<u32>| {
        q.and("YEAR(created_at) = ?", y as i64);
        if let Some(m) = m {
            q.and("MONTH(created_at) = ?", m as i64);
        }
    };
    let anchor = if r.start_date.is_some() { start } else { now };
    match r.duration.as_deref() {
        Some("today") => between(q, start_of_day(now.date()), end_of_day(now.date())),
        Some("yesterday") => {
            let y = now.date() - Duration::days(1);
            q.and("DATE(created_at) = ?", y.format("%Y-%m-%d").to_string());
        }
        Some("weekly") => {
            let monday = anchor.date() - Duration::days(anchor.weekday().num_days_from_monday() as i64);
            between(q, start_of_day(monday), end_of_day(monday + Duration::days(6)));
        }
        Some("monthly") => year_month(q, anchor.year(), Some(anchor.month())),
        Some("last_month") => {
            let d = add_months(now, -1);
            year_month(q, d.year(), Some(d.month()));
        }
        Some("yearly") => year_month(q, anchor.year(), None),
        Some("last_three_months") => {
            let d = add_months(now, -3);
            between(q, start_of_day(month_start(d.year(), d.month())), end);
        }
        Some("last_year") => year_month(q, add_months(now, -12).year(), None),
        Some("last_seven_days") => between(q, now - Duration::days(7), now),
        Some("last_six_months") => between(q, add_months(now, -6), now),
        Some("last_quarter") => {
            let first = (now.month0() / 3) * 3 + 1;
            let q_start = start_of_day(month_start(now.year(), first));
            let last = first + 2;
            let q_end = end_of_day(month_start(now.year(), last) + Duration::days(days_in_month(now.year(), last) as i64 - 1));
            between(q, add_months(q_start, -3), add_months(q_end, -3));
        }
        Some("last_biannual") => between(q, add_months(start_of_day(month_start(now.year(), 1)), -6), now),
        Some("last_biweek") => between(q, now - Duration::weeks(2), now),
        Some("last_work_week") => {
            let fri = previous(now, chrono::Weekday::Fri);
            between(q, previous(now, chrono::Weekday::Mon), end_of_day(fri.date()));
        }
        Some("custom") => between(q, start, end),
        _ => {}
    }
}

/// "3 days ago" / "2 weeks from now", like Carbon's diffForHumans() in English.
pub fn human_diff(then: NaiveDateTime, now: NaiveDateTime) -> String {
    let (a, b, future) = if then <= now { (then, now, false) } else { (now, then, true) };
    let mut months = (b.year() * 12 + b.month0() as i32) - (a.year() * 12 + a.month0() as i32);
    if (b.day(), b.time()) < (a.day(), a.time()) {
        months -= 1;
    }
    let secs = (b - a).num_seconds();
    let (n, unit) = if months >= 12 {
        (months as i64 / 12, "year")
    } else if months >= 1 {
        (months as i64, "month")
    } else if secs >= 7 * 86_400 {
        (secs / (7 * 86_400), "week")
    } else if secs >= 86_400 {
        (secs / 86_400, "day")
    } else if secs >= 3_600 {
        (secs / 3_600, "hour")
    } else if secs >= 60 {
        (secs / 60, "minute")
    } else {
        (secs.max(1), "second")
    };
    let plural = if n == 1 { "" } else { "s" };
    format!("{n} {unit}{plural} {}", if future { "from now" } else { "ago" })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dt(s: &str) -> NaiveDateTime {
        crate::datefmt::parse(s).unwrap()
    }

    #[test]
    fn months_overflow_like_php() {
        assert_eq!(add_months(dt("2024-03-31 10:00:00"), -1), dt("2024-03-02 10:00:00"));
        assert_eq!(add_months(dt("2024-12-31 23:59:59"), -3), dt("2024-10-01 23:59:59"));
        assert_eq!(add_months(dt("2024-01-15 00:00:00"), -6), dt("2023-07-15 00:00:00"));
    }

    #[test]
    fn previous_weekday() {
        // 2024-10-23 is a Wednesday
        assert_eq!(previous(dt("2024-10-23 15:00:00"), chrono::Weekday::Mon), dt("2024-10-21 00:00:00"));
        assert_eq!(previous(dt("2024-10-23 15:00:00"), chrono::Weekday::Wed), dt("2024-10-16 00:00:00"));
    }

    #[test]
    fn humans() {
        let now = dt("2024-10-23 12:00:00");
        assert_eq!(human_diff(now, now), "1 second ago");
        assert_eq!(human_diff(dt("2024-10-23 11:58:30"), now), "1 minute ago");
        assert_eq!(human_diff(dt("2024-10-20 12:00:00"), now), "3 days ago");
        assert_eq!(human_diff(dt("2024-10-02 12:00:00"), now), "3 weeks ago");
        assert_eq!(human_diff(dt("2024-08-23 12:00:00"), now), "2 months ago");
        assert_eq!(human_diff(dt("2022-10-22 12:00:00"), now), "2 years ago");
        assert_eq!(human_diff(dt("2024-10-24 12:00:01"), now), "1 day from now");
    }

    #[test]
    fn clock_times() {
        assert_eq!(norm_time(Some("09:30"), "00:00:00"), "09:30:00");
        assert_eq!(norm_time(Some("09:30:15"), "00:00:00"), "09:30:15");
        assert_eq!(norm_time(Some("9:30"), "23:59:59"), "23:59:59");
        assert_eq!(norm_time(None, "23:59:59"), "23:59:59");
    }
}
