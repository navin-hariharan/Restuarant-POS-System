//! Tax methods (Settings > Tax): list, create, edit, delete.

use super::records::{self, filled, is_bool_like, is_numeric, Col, Row};
use crate::{
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
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/taxes", get(index).post(store))
        .route("/admin/taxes/{tax}", get(show).put(update).patch(update).delete(destroy))
}

const MANAGE: &str = "tax_configuration";

/// TaxResource
pub fn tax_json(s: &Settings, r: &Row) -> Value {
    json!({
        "id": r.get("id"),
        "tax_title": r.get("tax_title"),
        "tax_rate": records::num(r, "tax_rate"),
        "is_vat": r.bool("is_vat"),
        "is_tax_fix": r.bool("is_tax_fix"),
        "tax_id": r.get("tax_id"),
        "is_tax_included": r.bool("is_tax_included"),
        "created_at": records::date(s, r, "created_at"),
        "updated_at": records::date(s, r, "updated_at"),
    })
}

/// PosTaxResource (the same without `tax_id`)
pub fn pos_tax_json(s: &Settings, r: &Row) -> Value {
    let mut v = tax_json(s, r);
    if let Some(o) = v.as_object_mut() {
        o.shift_remove("tax_id");
    }
    v
}

async fn index(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(&[MANAGE, "manage_food_items", "manage_reservations"])?;
    let rows = Sql::new("SELECT * FROM taxes").fetch_all(&state.db).await?;
    let s = state.settings.get().await;
    Ok(Json(Value::Array(rows.iter().map(|r| tax_json(&s, r)).collect())))
}

/// Rules of the tax form; returns the columns to write (only fields sent).
fn validate(input: &Input) -> AppResult<Vec<Col>> {
    let mut e = Errors::default();
    let title = input.data.get("tax_title");
    if !filled(title) {
        e.add("tax_title", tr!("The tax title field is required."));
    } else if let Some(t) = title {
        if !t.is_string() {
            e.add("tax_title", tr!("The tax title must be a string."));
        }
        if records::char_len(t) > 50 {
            e.add("tax_title", tr!("The tax title may not be greater than 50 characters."));
        }
    }
    let rate = input.data.get("tax_rate");
    if !filled(rate) {
        e.add("tax_rate", tr!("The tax rate field is required."));
    } else if !rate.map(is_numeric).unwrap_or(false) {
        e.add("tax_rate", tr!("The tax rate must be a number."));
    }
    if input.present("is_tax_included") && !is_bool_like(&input.val("is_tax_included")) {
        e.add("is_tax_included", tr!("The is tax included field must be true or false."));
    }
    if input.present("is_tax_fix") && !is_bool_like(&input.val("is_tax_fix")) {
        e.add("is_tax_fix", tr!("The is tax fix field must be true or false."));
    }
    if !filled(input.data.get("is_vat")) {
        e.add("is_vat", tr!("The is vat field is required."));
    }
    e.check()?;

    let mut cols = vec![Col::plain("tax_title", input.val("tax_title")), Col::plain("tax_rate", input.val("tax_rate"))];
    for key in ["is_tax_included", "is_tax_fix"] {
        if input.present(key) {
            cols.push(Col::boolean(key, input.val(key)));
        }
    }
    if input.present("tax_id") {
        cols.push(Col::plain("tax_id", input.val("tax_id")));
    }
    cols.push(Col::boolean("is_vat", bool_value(&input.val("is_vat"))));
    Ok(cols)
}

/// `is_vat` only has to be present; store it as 0/1 like a checkbox.
fn bool_value(v: &Value) -> Value {
    match v {
        Value::Bool(_) => v.clone(),
        Value::String(s) if s.eq_ignore_ascii_case("true") => Value::Bool(true),
        Value::String(s) if s.eq_ignore_ascii_case("false") => Value::Bool(false),
        other => Value::Bool(records::php_truthy(other)),
    }
}

async fn store(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let cols = validate(&input)?;
    let s = state.settings.get().await;
    let now = s.now();
    let id = records::insert(&state.db, "taxes", &cols, now).await?;
    // The new record as sent (fields left out stay null), like the previous API.
    let flag = |key: &str| if input.present(key) { Value::Bool(records::php_truthy(&bool_value(&input.val(key)))) } else { Value::Null };
    let stamp = Value::from(s.fmt_date(&now));
    Ok(Json(json!({
        "message": state.t("Data saved successfully").await,
        "tax": {
            "id": id,
            "tax_title": input.val("tax_title"),
            "tax_rate": input.val("tax_rate"),
            "is_vat": flag("is_vat"),
            "is_tax_fix": flag("is_tax_fix"),
            "tax_id": input.val("tax_id"),
            "is_tax_included": flag("is_tax_included"),
            "created_at": stamp.clone(),
            "updated_at": stamp,
        },
    })))
}

async fn show(State(state): State<AppState>, user: AuthUser, Path(tax): Path<String>) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let row = records::find(&state, "taxes", &tax).await?;
    let s = state.settings.get().await;
    Ok(Json(tax_json(&s, &row)))
}

async fn update(State(state): State<AppState>, user: AuthUser, Path(tax): Path<String>, input: Input) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let row = records::find(&state, "taxes", &tax).await?;
    let cols = validate(&input)?;
    let now = state.settings.get().await.now();
    records::update(&state.db, "taxes", &row, &cols, now).await?;
    Ok(Json(json!({ "message": state.t("Data updated successfully").await })))
}

async fn destroy(State(state): State<AppState>, user: AuthUser, Path(tax): Path<String>) -> AppResult<Json<Value>> {
    user.require(&[MANAGE])?;
    let row = records::find(&state, "taxes", &tax).await?;
    let id = row.i64("id");
    let s = state.settings.get().await;
    // The first tax, the default tax of the settings and taxes of products stay.
    let is_default = s.str("tax_id").trim() == id.to_string();
    if id < 2 || is_default || records::count_where(&state, "food_items", "tax_id", id).await? > 0 {
        return Err(AppError::unprocessable("Unable to remove tax method is being used"));
    }
    sqlx::query("DELETE FROM taxes WHERE id = ?").bind(id).execute(&state.db).await?;
    Ok(Json(json!({ "message": state.t("Data removed successfully").await })))
}
