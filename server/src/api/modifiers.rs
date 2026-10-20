//! Modifiers: extras offered with the food items of a category, with the
//! ingredients they consume (`ingredients_modifiers`).

use super::ingredients::{
    batch_ids, changes, check_cost, check_price, dnum, log, parse_consumption, pivot_groups, require, taken, unknown_ingredients,
    Consumption,
};
use crate::{
    auth::AuthUser,
    db::RowExt,
    error::{AppError, AppResult, Errors},
    input::Input,
    query::{bind_all, Sql},
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    middleware::from_fn,
    routing::{delete, get},
    Json, Router,
};
use serde_json::{json, Map, Value};
use sqlx::MySqlConnection;

pub fn router() -> Router<AppState> {
    Router::new().route("/admin/modifiers", get(index).post(store)).route("/admin/modifiers-rows-destroy", delete(destroy_batch)).route(
        "/admin/modifiers/{modifier}",
        delete(destroy).route_layer(from_fn(crate::middleware::demo_mode)).get(show).put(update).patch(update),
    )
}

const PERM: &[&str] = &["manage_modifiers"];
const SORTABLE: &[&str] = &["id", "title", "price", "cost", "food_category_id", "created_at", "updated_at"];

async fn find(state: &AppState, id: &str) -> AppResult<Map<String, Value>> {
    let Ok(id) = id.parse::<i64>() else { return Err(AppError::not_found()) };
    Sql::new("SELECT * FROM modifiers WHERE id = ?").push_args("", [id]).fetch_optional(&state.db).await?.ok_or_else(AppError::not_found)
}

async fn index(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let s = state.settings.get().await;
    let mut q = Sql::new("SELECT * FROM modifiers WHERE 1=1");
    if let Some(term) = input.str("search") {
        q.and("title LIKE ?", s.search_pattern(&term));
    }
    for key in ["category", "category_id"] {
        if let Some(v) = input.get(key).filter(|v| !matches!(v, Value::Array(a) if a.is_empty())) {
            q.and("food_category_id = ?", v);
        }
    }
    let (col, dir) = input.sort(SORTABLE, "created_at", "asc");
    q.push(&format!(" ORDER BY {} {dir}", crate::db::ident(&col)));
    let (rows, p) = q.paginate(&state.db, input.page(10)).await?;
    let cats = super::food_categories::by_ids(&state, rows.iter().filter_map(|r| r.opt_i64("food_category_id"))).await?;
    let items = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.val("id"),
                "title": r.val("title"),
                "price": dnum(r, "price"),
                "cost": dnum(r, "cost"),
                "category": r.opt_i64("food_category_id").and_then(|c| cats.get(&c).cloned()).unwrap_or(Value::Null),
                "created_at": s.fmt_value(&r.val("created_at")),
                "updated_at": s.fmt_value(&r.val("updated_at")),
            })
        })
        .collect();
    Ok(Json(crate::query::paged(items, p)))
}

async fn show(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let r = find(&state, &id).await?;
    let s = state.settings.get().await;
    let mut q = Sql::new(
        "SELECT ingredients.*, p.modifier_id AS pivot_key, p.quantity AS pivot_quantity FROM ingredients \
         INNER JOIN ingredients_modifiers p ON ingredients.id = p.ingredient_id WHERE p.modifier_id = ?",
    );
    q.args.push(r.i64("id").into());
    let ingredients = pivot_groups(&state, &q).await?.remove(&r.i64("id")).unwrap_or_default();
    Ok(Json(json!({
        "id": r.val("id"),
        "title": r.val("title"),
        "price": dnum(&r, "price"),
        "cost": dnum(&r, "cost"),
        "food_category_id": r.val("food_category_id"),
        "ingredients": ingredients,
        "created_at": s.fmt_value(&r.val("created_at")),
        "updated_at": s.fmt_value(&r.val("updated_at")),
    })))
}

/// Validate the form; returns the ingredient rows when `ingredients` was sent.
async fn validate(state: &AppState, input: &Input, except: Option<i64>) -> AppResult<Option<Vec<Consumption>>> {
    let mut errs = Errors::default();
    if require(&mut errs, input, "title") && taken(state, "modifiers", "title", &input.val("title"), except).await? {
        errs.add("title", "The title has already been taken.");
    }
    check_price(&mut errs, input);
    check_cost(&mut errs, input);
    let mut rows = None;
    if input.present("ingredients") {
        match input.val("ingredients") {
            Value::Array(_) | Value::Object(_) => match parse_consumption(&input.val("ingredients")) {
                Some(list) => {
                    let ids: Vec<i64> = list.iter().map(|c| c.id).collect();
                    if unknown_ingredients(state, &ids).await? {
                        errs.add("ingredients", "The selected ingredients is invalid.");
                    }
                    rows = Some(list);
                }
                None => errs.add("ingredients", "The selected ingredients is invalid."),
            },
            _ => errs.add("ingredients", "The ingredients must be an array"),
        }
    }
    if require(&mut errs, input, "food_category_id") {
        let exists = match input.i64("food_category_id") {
            Some(id) => {
                Sql::new("SELECT COUNT(*) AS c FROM food_categories WHERE id = ?").push_args("", [id]).scalar_f64(&state.db).await? > 0.0
            }
            None => false,
        };
        if !exists {
            errs.add("food_category_id", "The selected food category id is invalid.");
        }
    }
    errs.check()?;
    Ok(rows)
}

async fn attach(conn: &mut MySqlConnection, modifier_id: i64, rows: &[Consumption]) -> AppResult<()> {
    for c in rows {
        sqlx::query("INSERT INTO ingredients_modifiers (modifier_id, ingredient_id, quantity) VALUES (?, ?, ?)")
            .bind(modifier_id)
            .bind(c.id)
            .bind(c.quantity)
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

async fn store(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let ingredients = validate(&state, &input, None).await?;
    let now = state.settings.get().await.now();
    let mut tx = state.db.begin().await?;
    let id = sqlx::query("INSERT INTO modifiers (title, price, cost, food_category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(input.string("title"))
        .bind(input.f64("price").unwrap_or(0.0))
        .bind(input.f64("cost").unwrap_or(0.0))
        .bind(input.i64("food_category_id"))
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await?
        .last_insert_id() as i64;
    if let Some(rows) = &ingredients {
        attach(&mut tx, id, rows).await?;
    }
    tx.commit().await?;
    log(&state, &user, &headers, tr!("New food modifier added successfully"), None).await;
    Ok(Json(json!({ "message": state.t("Data saved successfully").await, "modifier": id })))
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
    input: Input,
) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let row = find(&state, &id).await?;
    let id = row.i64("id");
    let ingredients = validate(&state, &input, Some(id)).await?;
    let mut tx = state.db.begin().await?;
    let fields = ["title", "price", "cost", "food_category_id"];
    if fields.iter().any(|k| changes(&row.val(k), &input.val(k))) {
        let now = state.settings.get().await.now();
        sqlx::query("UPDATE modifiers SET title = ?, price = ?, cost = ?, food_category_id = ?, updated_at = ? WHERE id = ?")
            .bind(input.string("title"))
            .bind(input.f64("price").unwrap_or(0.0))
            .bind(input.f64("cost").unwrap_or(0.0))
            .bind(input.i64("food_category_id"))
            .bind(now)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(rows) = &ingredients {
        sqlx::query("DELETE FROM ingredients_modifiers WHERE modifier_id = ?").bind(id).execute(&mut *tx).await?;
        attach(&mut tx, id, rows).await?;
    }
    tx.commit().await?;
    log(&state, &user, &headers, tr!("Food modifier updated successfully"), None).await;
    Ok(Json(json!({ "message": state.t("Data updated successfully").await })))
}

async fn remove(state: &AppState, ids: &[i64]) -> AppResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let list = vec!["?"; ids.len()].join(",");
    let args: Vec<crate::query::Arg> = ids.iter().map(|i| (*i).into()).collect();
    let mut tx = state.db.begin().await?;
    for sql in
        [format!("DELETE FROM ingredients_modifiers WHERE modifier_id IN ({list})"), format!("DELETE FROM modifiers WHERE id IN ({list})")]
    {
        bind_all(sqlx::query(&sql), &args).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

async fn destroy(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let row = find(&state, &id).await?;
    remove(&state, &[row.i64("id")]).await?;
    log(&state, &user, &headers, tr!("Food modifier removed successfully"), None).await;
    Ok(Json(json!({ "message": state.t("Data removed successfully").await })))
}

async fn destroy_batch(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let mut q = Sql::new("SELECT id FROM modifiers WHERE 1=1");
    q.and_in("id", batch_ids(&input));
    let ids: Vec<i64> = q.fetch_all(&state.db).await?.iter().map(|r| r.i64("id")).collect();
    remove(&state, &ids).await?;
    for _ in &ids {
        log(&state, &user, &headers, tr!("Food modifier removed successfully"), None).await;
    }
    Ok(Json(json!({ "message": state.t("Data removed successfully").await })))
}
