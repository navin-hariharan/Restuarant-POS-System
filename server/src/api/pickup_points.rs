//! Pickup points (Setup > Pickup points) for pickup orders.

use super::records::{self, filled, Col, Row};
use crate::{
    activity,
    auth::AuthUser,
    db::RowExt,
    error::{AppError, AppResult, Errors},
    input::Input,
    query::Sql,
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
        .route("/admin/pickup-points", get(index).post(store))
        .route("/admin/pickup-points/{pickup_point}", get(show).put(update).patch(update))
        .merge(
            Router::new()
                .route("/admin/pickup-points/{pickup_point}", delete(destroy))
                .route_layer(axum::middleware::from_fn(crate::middleware::demo_mode)),
        )
}

const MANAGE: &str = "manage_pickup_points";

/// PickupPointResource
pub fn point_json(s: &Settings, r: &Row) -> Value {
    json!({
        "id": r.get("id"),
        "place_title": r.get("place_title"),
        "person_name": r.get("person_name"),
        "phone": r.get("phone"),
        "address": r.get("address"),
        "created_at": records::date(s, r, "created_at"),
        "updated_at": records::date(s, r, "updated_at"),
    })
}

async fn index(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let rows = Sql::new("SELECT * FROM pickup_points ORDER BY created_at DESC").fetch_all(&state.db).await?;
    let s = state.settings.get().await;
    Ok(Json(Value::Array(rows.iter().map(|r| point_json(&s, r)).collect())))
}

/// `ignore` is the record being edited (its own title is not a duplicate).
async fn validate(state: &AppState, input: &Input, ignore: Option<i64>) -> AppResult<Vec<Col>> {
    let mut e = Errors::default();
    let title = input.val("place_title");
    if !filled(Some(&title)) {
        e.add("place_title", tr!("The place title field is required."));
    } else {
        // max:255 is part of the edit rules only
        if ignore.is_some() && records::char_len(&title) > 255 {
            e.add("place_title", tr!("The place title may not be greater than 255 characters."));
        }
        if records::taken(state, "pickup_points", "place_title", &title, ignore).await? {
            e.add("place_title", tr!("The place title has already been taken."));
        }
    }
    if let Some(name) = input.get("person_name") {
        if records::char_len(name) > 255 {
            e.add("person_name", tr!("The person name may not be greater than 255 characters."));
        }
    }
    e.check()?;
    let mut cols = vec![Col::plain("place_title", title)];
    for key in ["person_name", "phone", "address"] {
        if input.present(key) {
            cols.push(Col::plain(key, input.val(key)));
        }
    }
    Ok(cols)
}

async fn store(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let cols = validate(&state, &input, None).await?;
    let s = state.settings.get().await;
    let id = records::insert(&state.db, "pickup_points", &cols, s.now()).await?;
    let row = records::find_by(&state, "pickup_points", "id", id).await?;
    activity::log(&state, &user, &headers, &state.t("New pickup point added successfully").await, None).await;
    Ok(Json(json!({
        "message": state.t("Data saved successfully").await,
        "point": point_json(&s, &row),
    })))
}

async fn show(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let row = records::find(&state, "pickup_points", &id).await?;
    let s = state.settings.get().await;
    Ok(Json(point_json(&s, &row)))
}

async fn update(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(id): Path<String>, input: Input) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let row = records::find(&state, "pickup_points", &id).await?;
    let cols = validate(&state, &input, Some(row.i64("id"))).await?;
    let now = state.settings.get().await.now();
    records::update(&state.db, "pickup_points", &row, &cols, now).await?;
    activity::log(&state, &user, &headers, &state.t("Pickup point updated successfully").await, None).await;
    Ok(Json(json!({ "message": state.t("Data updated successfully").await })))
}

async fn destroy(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let row = records::find(&state, "pickup_points", &id).await?;
    let id = row.i64("id");
    if records::count_where(&state, "sales", "pickup_point_id", id).await? > 0 {
        return Err(AppError::unprocessable("Unable to remove pickup point information is being used"));
    }
    sqlx::query("DELETE FROM pickup_points WHERE id = ?").bind(id).execute(&state.db).await?;
    activity::log(&state, &user, &headers, &state.t("Pickup point removed successfully").await, None).await;
    Ok(Json(json!({ "message": state.t("Data removed successfully").await })))
}
