//! Customers (People > Customers, and the customer picker of the POS).
//! Customers are addressed by their uuid.

use super::records::{self, filled, Col, Row};
use crate::{
    activity,
    auth::AuthUser,
    db::RowExt,
    error::{AppError, AppResult, Errors},
    input::Input,
    query::{paged, Sql},
    settings::Settings,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{delete, get},
    Json, Router,
};
use serde_json::{json, Value};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/customers", get(index).post(store))
        .route("/admin/customers/{customer}", get(show))
        .merge(
            Router::new()
                .route("/admin/customers/{customer}", delete(destroy).put(update).patch(update))
                .route_layer(axum::middleware::from_fn(crate::middleware::demo_mode)),
        )
}

const SORTABLE: [&str; 8] = ["id", "uuid", "name", "email", "phone", "address", "created_at", "updated_at"];

/// CustomerResource
pub fn customer_json(s: &Settings, r: &Row) -> Value {
    let shipping = match records::json_col(r, "shipping_addresses") {
        Value::Null => json!([]),
        v => v,
    };
    json!({
        "id": r.get("id"),
        "uuid": r.get("uuid"),
        "name": r.get("name"),
        "email": r.get("email"),
        "phone": r.get("phone"),
        "address": r.get("address"),
        "shipping_addresses": shipping,
        "created_at": records::date(s, r, "created_at"),
        "updated_at": records::date(s, r, "updated_at"),
    })
}

async fn index(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(&["manage_customers"])?;
    let s = state.settings.get().await;
    let mut q = Sql::new("SELECT * FROM customers WHERE 1=1");
    if let Some(term) = input.opt_str("search") {
        let p = s.search_pattern(&term);
        q.push_args(" AND (name LIKE ? OR email LIKE ? OR phone LIKE ? OR address LIKE ?)", [p.clone(), p.clone(), p.clone(), p]);
    }
    let (col, order) = input.sort(&SORTABLE, "created_at", "asc");
    q.push(&format!(" ORDER BY {} {order}", crate::db::ident(&col)));
    let (rows, pagination) = q.paginate(&state.db, input.page(10)).await?;
    Ok(Json(paged(rows.iter().map(|r| customer_json(&s, r)).collect(), pagination)))
}

/// Rules of the customer form; returns the columns to write (only fields sent).
fn validate(input: &Input) -> AppResult<Vec<Col>> {
    let mut e = Errors::default();
    let name = input.data.get("name");
    if !filled(name) {
        e.add("name", tr!("The name field is required."));
    } else if name.map(records::char_len).unwrap_or(0) > 255 {
        e.add("name", tr!("The name may not be greater than 255 characters."));
    }
    if let Some(email) = input.get("email") {
        if !records::php_str(email).map(|s| records::is_email(&s)).unwrap_or(false) {
            e.add("email", tr!("The email must be a valid email address."));
        }
        if records::char_len(email) > 255 {
            e.add("email", tr!("The email may not be greater than 255 characters."));
        }
    }
    if let Some(address) = input.get("address") {
        if records::char_len(address) > 255 {
            e.add("address", tr!("The address may not be greater than 255 characters."));
        }
    }
    if input.present("shipping_addresses") && !matches!(input.val("shipping_addresses"), Value::Array(_) | Value::Object(_)) {
        e.add("shipping_addresses", tr!("The shipping addresses must be an array"));
    }
    e.check()?;

    let mut cols = vec![Col::plain("name", input.val("name"))];
    for key in ["email", "phone", "address"] {
        if input.present(key) {
            cols.push(Col::plain(key, input.val(key)));
        }
    }
    if input.present("shipping_addresses") {
        cols.push(Col::json("shipping_addresses", input.val("shipping_addresses")));
    }
    Ok(cols)
}

async fn store(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    user.require(&["manage_customers", "pos_portal"])?;
    let mut cols = validate(&input)?;
    cols.push(Col::plain("uuid", Value::from(crate::util::uuid())));
    let s = state.settings.get().await;
    let id = records::insert(&state.db, "customers", &cols, s.now()).await?;
    let row = records::find_by(&state, "customers", "id", id).await?;
    activity::log(&state, &user, &headers, &state.t("New customer created successfully").await, row.opt_str("name").as_deref()).await;
    Ok(Json(json!({
        "message": state.t("Data saved successfully").await,
        "customer": customer_json(&s, &row),
    })))
}

async fn show(State(state): State<AppState>, user: AuthUser, Path(customer): Path<String>) -> AppResult<Json<Value>> {
    user.require(&["manage_customers", "pos_portal"])?;
    let row = records::find_by(&state, "customers", "uuid", customer).await?;
    let s = state.settings.get().await;
    Ok(Json(customer_json(&s, &row)))
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    Path(customer): Path<String>,
    input: Input,
) -> AppResult<Json<Value>> {
    user.require(&["manage_customers", "pos_portal"])?;
    let row = records::find_by(&state, "customers", "uuid", customer).await?;
    let cols = validate(&input)?;
    let now = state.settings.get().await.now();
    records::update(&state.db, "customers", &row, &cols, now).await?;
    let name = records::php_str(&input.val("name"));
    activity::log(&state, &user, &headers, &state.t("Customer information updated successfully").await, name.as_deref()).await;
    Ok(Json(json!({ "message": state.t("Data updated successfully").await })))
}

async fn destroy(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(customer): Path<String>) -> AppResult<Json<Value>> {
    user.require(&["manage_customers"])?;
    let row = records::find_by(&state, "customers", "uuid", customer).await?;
    let id = row.i64("id");
    // The walk-in customer and customers with orders or room bookings stay.
    let in_use = id <= 1
        || records::count_where(&state, "sales", "customer_id", id).await? > 0
        || records::count_where(&state, "guest_room_reservations", "customer_id", id).await? > 0;
    if in_use {
        return Err(AppError::unprocessable("Unable to remove customer information is being used"));
    }
    activity::log(&state, &user, &headers, &state.t("Customer removed successfully").await, row.opt_str("name").as_deref()).await;
    sqlx::query("DELETE FROM customers WHERE id = ?").bind(id).execute(&state.db).await?;
    Ok(Json(json!({ "message": state.t("Data removed successfully").await })))
}
