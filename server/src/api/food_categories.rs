//! Food categories. Deleting a category also deletes its food items (with
//! their variants and ingredient rows); its modifiers are kept without a
//! category.

use super::ingredients::{batch_ids, changes, log, require, taken};
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
use std::collections::HashMap;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/food-categories", get(index).post(store))
        .route("/admin/food-categories-list", get(list))
        .route("/admin/food-category-rows-destroy", delete(destroy_batch))
        .route(
            "/admin/food-categories/{food_category}",
            delete(destroy).route_layer(from_fn(crate::middleware::demo_mode)).get(show).put(update).patch(update),
        )
}

const PERM: &[&str] = &["manage_food_categories"];
const SORTABLE: &[&str] = &["id", "name", "image", "created_at", "updated_at"];
const IMAGE_FOLDER: &str = "categories";

/// Category image URL (or the default category picture).
pub(crate) fn image_url(state: &AppState, image: Option<String>) -> String {
    match image.filter(|i| !i.is_empty()) {
        Some(path) => state.storage_url(&path),
        None => state.asset_url("images/default/category.png"),
    }
}

/// Category JSON for each row, with the number of food items in it.
pub(crate) async fn resources(state: &AppState, rows: &[Map<String, Value>]) -> AppResult<Vec<Value>> {
    let s = state.settings.get().await;
    let ids: Vec<i64> = rows.iter().map(|r| r.i64("id")).collect();
    let mut counts: HashMap<i64, i64> = HashMap::new();
    if !ids.is_empty() {
        let mut q = Sql::new("SELECT food_category_id AS id, COUNT(*) AS c FROM food_items WHERE 1=1");
        q.and_in("food_category_id", ids.iter().copied());
        q.push(" GROUP BY food_category_id");
        for r in q.fetch_all(&state.db).await? {
            counts.insert(r.i64("id"), r.i64("c"));
        }
    }
    Ok(rows
        .iter()
        .map(|r| {
            json!({
                "id": r.val("id"),
                "name": r.val("name"),
                "slug": Value::Null,
                "image": image_url(state, r.opt_str("image")),
                "linked": counts.get(&r.i64("id")).copied().unwrap_or(0),
                "created_at": s.fmt_value(&r.val("created_at")),
            })
        })
        .collect())
}

/// Category JSON by id for the given ids (missing ids are left out).
pub(crate) async fn by_ids(state: &AppState, ids: impl IntoIterator<Item = i64>) -> AppResult<HashMap<i64, Value>> {
    let ids: Vec<i64> = ids.into_iter().collect::<std::collections::HashSet<_>>().into_iter().collect();
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let mut q = Sql::new("SELECT * FROM food_categories WHERE 1=1");
    q.and_in("id", ids);
    let rows = q.fetch_all(&state.db).await?;
    let json = resources(state, &rows).await?;
    Ok(rows.iter().map(|r| r.i64("id")).zip(json).collect())
}

async fn find(state: &AppState, id: &str) -> AppResult<Map<String, Value>> {
    let Ok(id) = id.parse::<i64>() else { return Err(AppError::not_found()) };
    Sql::new("SELECT * FROM food_categories WHERE id = ?")
        .push_args("", [id])
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(AppError::not_found)
}

async fn index(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(&["manage_food_categories", "manage_food_items", "manage_modifiers"])?;
    let s = state.settings.get().await;
    let mut q = Sql::new("SELECT * FROM food_categories WHERE 1=1");
    if let Some(term) = input.str("search") {
        q.and("name LIKE ?", s.search_pattern(&term));
    }
    let (col, dir) = input.sort(SORTABLE, "created_at", "asc");
    q.push(&format!(" ORDER BY {} {dir}", crate::db::ident(&col)));
    let (rows, p) = q.paginate(&state.db, input.page(10)).await?;
    Ok(Json(crate::query::paged(resources(&state, &rows).await?, p)))
}

async fn list(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require(&[
        "manage_food_categories",
        "manage_food_items",
        "manage_modifiers",
        "category_based_report",
        "most_sold_items_report",
        "import_exports",
    ])?;
    let rows = Sql::new("SELECT * FROM food_categories").fetch_all(&state.db).await?;
    Ok(Json(Value::Array(resources(&state, &rows).await?)))
}

async fn show(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let row = find(&state, &id).await?;
    Ok(Json(resources(&state, &[row]).await?.pop().unwrap_or(Value::Null)))
}

async fn validate(state: &AppState, input: &Input, except: Option<i64>) -> AppResult<()> {
    let mut errs = Errors::default();
    if require(&mut errs, input, "name") && taken(state, "food_categories", "name", &input.val("name"), except).await? {
        errs.add("name", "The name has already been taken.");
    }
    errs.check()
}

/// Store the uploaded `image`, if any.
async fn upload(state: &AppState, input: &mut Input) -> AppResult<Option<String>> {
    match input.take_file("image") {
        Some(file) => Ok(Some(crate::uploads::store_image(state, &file, IMAGE_FOLDER, "image").await?)),
        None => Ok(None),
    }
}

async fn store(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, mut input: Input) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    validate(&state, &input, None).await?;
    let image = upload(&state, &mut input).await?;
    let name = input.string("name");
    let now = state.settings.get().await.now();
    let res = sqlx::query("INSERT INTO food_categories (name, image, created_at, updated_at) VALUES (?, ?, ?, ?)")
        .bind(&name)
        .bind(&image)
        .bind(now)
        .bind(now)
        .execute(&state.db)
        .await;
    let res = match res {
        Ok(r) => r,
        Err(e) => {
            crate::uploads::delete(&state, image.as_deref()).await;
            return Err(e.into());
        }
    };
    log(&state, &user, &headers, tr!("New food category added successfully"), Some(&name)).await;
    let row = find(&state, &res.last_insert_id().to_string()).await?;
    Ok(Json(json!({
        "message": state.t("Data saved successfully").await,
        "category": resources(&state, &[row]).await?.pop().unwrap_or(Value::Null),
    })))
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
    mut input: Input,
) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let row = find(&state, &id).await?;
    let id = row.i64("id");
    validate(&state, &input, Some(id)).await?;
    let image = upload(&state, &mut input).await?;
    let name = input.string("name");
    if image.is_some() || changes(&row.val("name"), &input.val("name")) {
        let now = state.settings.get().await.now();
        let res = sqlx::query("UPDATE food_categories SET name = ?, image = COALESCE(?, image), updated_at = ? WHERE id = ?")
            .bind(&name)
            .bind(&image)
            .bind(now)
            .bind(id)
            .execute(&state.db)
            .await;
        if let Err(e) = res {
            crate::uploads::delete(&state, image.as_deref()).await;
            return Err(e.into());
        }
    }
    log(&state, &user, &headers, tr!("Food category updated successfully"), Some(&name)).await;
    Ok(Json(json!({ "message": state.t("Data updated successfully").await })))
}

/// Delete categories with their food items (variants and ingredient rows
/// too); modifiers of these categories are kept without a category.
async fn remove(state: &AppState, ids: &[i64]) -> AppResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let mut tx = state.db.begin().await?;
    let items = "SELECT id FROM food_items WHERE food_category_id IN";
    let list = vec!["?"; ids.len()].join(",");
    let steps = [
        format!("DELETE FROM food_items_ingredients WHERE food_item_id IN (SELECT id FROM ({items} ({list})) AS x)"),
        format!("DELETE FROM food_item_attributes WHERE food_item_id IN (SELECT id FROM ({items} ({list})) AS x)"),
        format!("DELETE FROM food_items WHERE food_category_id IN ({list})"),
        format!("UPDATE modifiers SET food_category_id = NULL WHERE food_category_id IN ({list})"),
        format!("DELETE FROM food_categories WHERE id IN ({list})"),
    ];
    let args: Vec<crate::query::Arg> = ids.iter().map(|i| (*i).into()).collect();
    for sql in &steps {
        bind_all(sqlx::query(sql), &args).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

async fn destroy(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let row = find(&state, &id).await?;
    remove(&state, &[row.i64("id")]).await?;
    log(&state, &user, &headers, tr!("Food category removed successfully"), row.opt_str("name").as_deref()).await;
    Ok(Json(json!({ "message": state.t("Data removed successfully").await })))
}

async fn destroy_batch(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let mut q = Sql::new("SELECT id, name FROM food_categories WHERE 1=1");
    q.and_in("id", batch_ids(&input));
    let rows = q.fetch_all(&state.db).await?;
    let ids: Vec<i64> = rows.iter().map(|r| r.i64("id")).collect();
    remove(&state, &ids).await?;
    for r in &rows {
        log(&state, &user, &headers, tr!("Food products removed successfully"), None).await;
        log(&state, &user, &headers, tr!("Food category removed successfully"), r.opt_str("name").as_deref()).await;
    }
    Ok(Json(json!({ "message": state.t("Data removed successfully").await })))
}
