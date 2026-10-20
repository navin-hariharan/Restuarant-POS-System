//! Food items with their variants (`food_item_attributes`, each with its own
//! sku, price and cost) and ingredient consumption (`food_items_ingredients`).
//! Every create and update runs in one transaction.

use super::ingredients::{
    batch_rows, changes, check_cost, check_price, dnum, filled, is_numeric, log, parse_consumption, php_string, pivot_groups, require,
    taken, unknown_ingredients, Consumption,
};
use crate::{
    auth::AuthUser,
    db::RowExt,
    error::{AppError, AppResult, Errors},
    input::Input,
    query::{bind_all, Arg, Sql},
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    middleware::from_fn,
    routing::{delete, get},
    Json, Router,
};
use rand::seq::SliceRandom;
use serde_json::{json, Map, Value};
use sqlx::MySqlConnection;
use std::collections::{HashMap, HashSet};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/food-items", get(index).post(store))
        .route("/admin/food-items-rows-destroy", delete(destroy_batch))
        .route("/admin/food-items-attributes/{attribute}", delete(destroy_attribute))
        .route(
            "/admin/food-items/{food_item}",
            delete(destroy).route_layer(from_fn(crate::middleware::demo_mode)).get(show).put(update).patch(update),
        )
}

const PERM: &[&str] = &["manage_food_items"];
const SORTABLE: &[&str] = &[
    "id",
    "uuid",
    "sku",
    "name",
    "price",
    "cost",
    "image",
    "food_category_id",
    "description",
    "created_at",
    "updated_at",
    "is_bar_type",
    "has_variants",
    "tax_id",
    "expiry_date",
];
const IMAGE_FOLDER: &str = "food-items";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/// Display width of a character (East Asian wide characters count twice).
fn char_width(c: char) -> usize {
    let u = c as u32;
    let wide = matches!(u,
        0x1100..=0x115F | 0x2E80..=0x303E | 0x3041..=0x33FF | 0x3400..=0x4DBF | 0x4E00..=0x9FFF |
        0xA000..=0xA4CF | 0xAC00..=0xD7A3 | 0xF900..=0xFAFF | 0xFE30..=0xFE4F | 0xFF00..=0xFF60 |
        0xFFE0..=0xFFE6 | 0x20000..=0x2FFFD | 0x30000..=0x3FFFD);
    if wide {
        2
    } else {
        1
    }
}

/// Up to three display columns of the name (words joined), upper-cased.
fn sku_prefix(name: &str) -> String {
    let joined: String = name.replace(['-', '_'], " ").split(' ').collect();
    let mut width = 0;
    let mut out = String::new();
    for c in joined.chars() {
        width += char_width(c);
        if width > 3 {
            break;
        }
        out.push(c);
    }
    out.trim_end().to_uppercase()
}

/// Generated SKU: first letters of the name and six digits, e.g. "CHI-482913"
/// (same shape as the SKUs created before).
pub(crate) fn generate_sku(name: &str) -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let mut digits: Vec<char> = format!("{secs:0>8}").repeat(2).chars().collect();
    digits.shuffle(&mut rand::rng());
    let signature: String = digits.into_iter().take(6).collect();
    format!("{}-{}", sku_prefix(name), signature).to_uppercase()
}

/// Form values sent as the text "null" / "undefined" mean "no value".
fn opt_text(input: &Input, key: &str) -> Option<String> {
    input.opt_str(key)
}

/// Expired when the expiry date has passed (in the restaurant's time zone).
fn is_expired(expiry: Option<&str>, now: chrono::NaiveDateTime) -> bool {
    match expiry.map(str::trim).filter(|e| !e.is_empty() && *e != "null" && *e != "0") {
        Some(e) => crate::datefmt::parse(e).map(|d| now > d).unwrap_or(false),
        None => false,
    }
}

#[derive(Debug, Clone)]
struct Variant {
    id: Option<i64>,
    name: String,
    sku: Option<String>,
    price: f64,
    cost: f64,
    ingredients: Vec<Consumption>,
}

/// A JSON list sent either as JSON text (form data) or as a JSON value.
fn json_list(input: &Input, key: &str) -> Vec<Value> {
    match input.json(key) {
        Some(Value::Array(a)) => a,
        Some(Value::Object(o)) => o.into_iter().map(|(_, v)| v).collect(),
        _ => vec![],
    }
}

fn str_field(o: &Map<String, Value>, key: &str) -> Option<String> {
    match o.get(key)? {
        Value::String(s) if !s.trim().is_empty() => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// Check the variants list; errors are keyed as nested fields.
fn parse_variants(list: &[Value], errs: &mut Errors) -> Vec<Variant> {
    let mut out = vec![];
    for (i, v) in list.iter().enumerate() {
        let Some(o) = v.as_object() else {
            errs.add(&format!("variants.{i}"), format!("The variants.{i} field is invalid."));
            continue;
        };
        let name = str_field(o, "name");
        if name.is_none() {
            errs.add(&format!("variants.{i}.name"), format!("The variants.{i}.name field is required."));
        }
        let mut number = |key: &str| -> f64 {
            match o.get(key) {
                None | Some(Value::Null) => {
                    errs.add(&format!("variants.{i}.{key}"), format!("The variants.{i}.{key} field is required."));
                    0.0
                }
                Some(Value::String(s)) if s.trim().is_empty() => {
                    errs.add(&format!("variants.{i}.{key}"), format!("The variants.{i}.{key} field is required."));
                    0.0
                }
                Some(x) if !is_numeric(x) => {
                    errs.add(&format!("variants.{i}.{key}"), format!("The variants.{i}.{key} must be a number."));
                    0.0
                }
                Some(x) => crate::util::num(x),
            }
        };
        let price = number("price");
        let cost = number("cost");
        let id = match o.get("id") {
            Some(Value::Number(n)) => n.as_i64().filter(|i| *i != 0),
            Some(Value::String(s)) => s.trim().parse::<i64>().ok().filter(|i| *i != 0),
            _ => None,
        };
        let ingredients = match o.get("ingredients") {
            None | Some(Value::Null) => vec![],
            Some(x) => parse_consumption(x).unwrap_or_else(|| {
                errs.add(&format!("variants.{i}.ingredients"), format!("The selected variants.{i}.ingredients is invalid."));
                vec![]
            }),
        };
        out.push(Variant { id, name: name.unwrap_or_default(), sku: str_field(o, "sku"), price, cost, ingredients });
    }
    out
}

/// Everything a create or update writes, after validation.
struct Form {
    name: String,
    food_category_id: i64,
    sku: String,
    price: f64,
    cost: f64,
    description: Option<Option<String>>,
    is_bar_type: bool,
    has_variants: bool,
    tax_id: Option<i64>,
    expiry_date: Option<String>,
    ingredients: Vec<Consumption>,
    variants: Vec<Variant>,
}

/// Validate the form in the order of the previous rules (first error = message).
async fn validate(state: &AppState, input: &Input, item: Option<&Map<String, Value>>) -> AppResult<Form> {
    let except = item.map(|r| r.i64("id"));
    let mut errs = Errors::default();

    if require(&mut errs, input, "name") && taken(state, "food_items", "name", &input.val("name"), except).await? {
        errs.add("name", "The name has already been taken.");
    }
    let mut category = None;
    if require(&mut errs, input, "food_category_id") {
        category = input.i64("food_category_id");
        let exists = match category {
            Some(id) => {
                Sql::new("SELECT COUNT(*) AS c FROM food_categories WHERE id = ?").push_args("", [id]).scalar_f64(&state.db).await? > 0.0
            }
            None => false,
        };
        if !exists {
            errs.add("food_category_id", "The selected food category id is invalid.");
        }
    }
    let sku = opt_text(input, "sku");
    if let Some(sku) = &sku {
        if taken(state, "food_items", "sku", &Value::from(sku.as_str()), except).await? {
            errs.add("sku", "The sku has already been taken.");
        }
    }
    check_cost(&mut errs, input);
    check_price(&mut errs, input);

    let has_variants = input.bool("has_variants");
    let mut ingredients = vec![];
    if !has_variants {
        match parse_consumption(&Value::Array(json_list(input, "ingredients"))) {
            Some(list) => {
                if unknown_ingredients(state, &list.iter().map(|c| c.id).collect::<Vec<_>>()).await? {
                    errs.add("ingredients", "The selected ingredients is invalid.");
                }
                ingredients = list;
            }
            None => errs.add("ingredients", "The selected ingredients is invalid."),
        }
    }
    if filled(input, "is_bar_type").is_none() {
        errs.add("is_bar_type", "The is bar type field is required.");
    }
    let mut variants = vec![];
    if has_variants {
        variants = parse_variants(&json_list(input, "variants"), &mut errs);
        let own: HashSet<i64> = match except {
            Some(id) => Sql::new("SELECT id FROM food_item_attributes WHERE food_item_id = ?")
                .push_args("", [id])
                .fetch_all(&state.db)
                .await?
                .iter()
                .map(|r| r.i64("id"))
                .collect(),
            None => HashSet::new(),
        };
        for (i, v) in variants.iter().enumerate() {
            if let (Some(id), Some(_)) = (v.id, except) {
                if !own.contains(&id) {
                    errs.add(&format!("variants.{i}.id"), format!("The selected variants.{i}.id is invalid."));
                }
            }
            if unknown_ingredients(state, &v.ingredients.iter().map(|c| c.id).collect::<Vec<_>>()).await? {
                errs.add(&format!("variants.{i}.ingredients"), format!("The selected variants.{i}.ingredients is invalid."));
            }
        }
    }
    let mut tax_id = None;
    if require(&mut errs, input, "tax_id") {
        if let Some(raw) = opt_text(input, "tax_id") {
            tax_id = raw.trim().parse::<i64>().ok();
            let exists = match tax_id {
                Some(id) => Sql::new("SELECT COUNT(*) AS c FROM taxes WHERE id = ?").push_args("", [id]).scalar_f64(&state.db).await? > 0.0,
                None => false,
            };
            if !exists {
                errs.add("tax_id", "The selected tax id is invalid.");
            }
        }
    }
    let expiry_date = opt_text(input, "expiry_date");
    if let Some(e) = &expiry_date {
        if crate::datefmt::parse(e).is_none() {
            errs.add("expiry_date", "The expiry date is not a valid date.");
        }
    }
    errs.check()?;

    let name = input.string("name");
    Ok(Form {
        sku: sku.unwrap_or_else(|| generate_sku(&name)),
        name,
        food_category_id: category.unwrap_or_default(),
        price: input.f64("price").unwrap_or(0.0),
        cost: input.f64("cost").unwrap_or(0.0),
        description: input.present("description").then(|| input.str("description")),
        is_bar_type: input.bool("is_bar_type"),
        has_variants,
        tax_id,
        expiry_date,
        ingredients,
        variants,
    })
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

fn image_url(state: &AppState, image: Option<String>) -> String {
    match image.filter(|i| !i.is_empty()) {
        Some(path) => state.storage_url(&path),
        None => state.asset_url("images/default/product.png"),
    }
}

async fn list_resources(state: &AppState, rows: &[Map<String, Value>]) -> AppResult<Vec<Value>> {
    let s = state.settings.get().await;
    let now = s.now();
    let cats = super::food_categories::by_ids(state, rows.iter().map(|r| r.i64("food_category_id"))).await?;
    let mut variants: HashMap<i64, i64> = HashMap::new();
    if !rows.is_empty() {
        let mut q = Sql::new("SELECT food_item_id AS id, COUNT(*) AS c FROM food_item_attributes WHERE 1=1");
        q.and_in("food_item_id", rows.iter().map(|r| r.i64("id")));
        q.push(" GROUP BY food_item_id");
        for r in q.fetch_all(&state.db).await? {
            variants.insert(r.i64("id"), r.i64("c"));
        }
    }
    Ok(rows
        .iter()
        .map(|r| {
            json!({
                "id": r.val("id"),
                "uuid": r.val("uuid"),
                "sku": r.val("sku"),
                "name": r.val("name"),
                "cost": dnum(r, "cost"),
                "price": dnum(r, "price"),
                "is_bar_type": r.bool("is_bar_type"),
                "has_variants": r.bool("has_variants"),
                "variants": variants.get(&r.i64("id")).copied().unwrap_or(0),
                "image": image_url(state, r.opt_str("image")),
                "expiry_date": r.val("expiry_date"),
                "is_expired": is_expired(r.opt_str("expiry_date").as_deref(), now),
                "category": cats.get(&r.i64("food_category_id")).cloned().unwrap_or(Value::Null),
                "created_at": s.fmt_value(&r.val("created_at")),
                "updated_at": s.fmt_value(&r.val("updated_at")),
            })
        })
        .collect())
}

async fn detail(state: &AppState, r: &Map<String, Value>) -> AppResult<Value> {
    let s = state.settings.get().await;
    let id = r.i64("id");
    let image = image_url(state, r.opt_str("image"));
    let cats = super::food_categories::by_ids(state, [r.i64("food_category_id")]).await?;

    let attributes = Sql::new("SELECT * FROM food_item_attributes WHERE food_item_id = ?").push_args("", [id]).fetch_all(&state.db).await?;
    let mut variant_ingredients = HashMap::new();
    let mut modifiers = vec![];
    if !attributes.is_empty() {
        let mut q = Sql::new(
            "SELECT ingredients.*, p.food_item_attribute_id AS pivot_key, p.quantity AS pivot_quantity FROM ingredients \
             INNER JOIN food_items_ingredients p ON ingredients.id = p.ingredient_id WHERE 1=1",
        );
        q.and_in("p.food_item_attribute_id", attributes.iter().map(|a| a.i64("id")));
        q.push(" ORDER BY p.id");
        variant_ingredients = pivot_groups(state, &q).await?;
        modifiers = Sql::new("SELECT * FROM modifiers")
            .fetch_all(&state.db)
            .await?
            .iter()
            .map(|m| {
                json!({
                    "id": m.val("id"),
                    "title": m.val("title"),
                    "price": dnum(m, "price"),
                    "cost": dnum(m, "cost"),
                    "qty": 1,
                    "created_at": s.fmt_value(&m.val("created_at")),
                    "updated_at": s.fmt_value(&m.val("updated_at")),
                })
            })
            .collect();
    }
    let variants: Vec<Value> = attributes
        .iter()
        .map(|a| {
            json!({
                "id": a.val("id"),
                "food_item_id": id,
                "name": a.val("name"),
                "image": image,
                "price": dnum(a, "price"),
                "cost": dnum(a, "cost"),
                "sku": a.val("sku"),
                "ingredients": variant_ingredients.get(&a.i64("id")).cloned().unwrap_or_default(),
                "modifiers": modifiers,
                "updated_at": s.fmt_value(&a.val("updated_at")),
                "created_at": s.fmt_value(&a.val("created_at")),
                "in_stock": 200,
            })
        })
        .collect();

    let mut q = Sql::new(
        "SELECT ingredients.*, p.food_item_id AS pivot_key, p.quantity AS pivot_quantity FROM ingredients \
         INNER JOIN food_items_ingredients p ON ingredients.id = p.ingredient_id WHERE p.food_item_id = ? ORDER BY p.id",
    );
    q.args.push(id.into());
    let ingredients = pivot_groups(state, &q).await?.remove(&id).unwrap_or_default();

    Ok(json!({
        "id": id,
        "name": r.val("name"),
        "image": image,
        "category": cats.get(&r.i64("food_category_id")).cloned().unwrap_or(Value::Null),
        "price": dnum(r, "price"),
        "cost": dnum(r, "cost"),
        "sku": r.val("sku"),
        "description": r.val("description"),
        "is_bar_type": r.bool("is_bar_type"),
        "has_variants": r.bool("has_variants"),
        "tax_id": r.val("tax_id"),
        "expiry_date": r.val("expiry_date"),
        "variants": variants,
        "ingredients": ingredients,
        "updated_at": s.fmt_value(&r.val("updated_at")),
        "created_at": s.fmt_value(&r.val("created_at")),
    }))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn find(state: &AppState, uuid: &str) -> AppResult<Map<String, Value>> {
    Sql::new("SELECT * FROM food_items WHERE uuid = ?")
        .push_args("", [uuid])
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(AppError::not_found)
}

async fn index(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let s = state.settings.get().await;
    let mut q = Sql::new("SELECT * FROM food_items WHERE 1=1");
    if let Some(term) = input.str("search") {
        let p = s.search_pattern(&term);
        q.push_args(" AND (name LIKE ? OR sku LIKE ?)", [p.clone(), p]);
    }
    for key in ["category", "category_id"] {
        if let Some(v) = input.get(key).filter(|v| !matches!(v, Value::Array(a) if a.is_empty())) {
            q.and("food_category_id = ?", v);
        }
    }
    let (col, dir) = input.sort(SORTABLE, "created_at", "asc");
    q.push(&format!(" ORDER BY {} {dir}", crate::db::ident(&col)));
    let (rows, p) = q.paginate(&state.db, input.page(10)).await?;
    Ok(Json(crate::query::paged(list_resources(&state, &rows).await?, p)))
}

async fn show(State(state): State<AppState>, user: AuthUser, Path(uuid): Path<String>) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let row = find(&state, &uuid).await?;
    Ok(Json(detail(&state, &row).await?))
}

async fn attach(conn: &mut MySqlConnection, item: i64, attribute: Option<i64>, rows: &[Consumption]) -> AppResult<()> {
    for c in rows {
        sqlx::query(
            "INSERT INTO food_items_ingredients (food_item_id, ingredient_id, quantity, food_item_attribute_id) VALUES (?, ?, ?, ?)",
        )
        .bind(item)
        .bind(c.id)
        .bind(c.quantity)
        .bind(attribute)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

async fn insert_variant(conn: &mut MySqlConnection, item: i64, v: &Variant, now: chrono::NaiveDateTime) -> AppResult<i64> {
    let id = sqlx::query(
        "INSERT INTO food_item_attributes (uuid, food_item_id, sku, price, cost, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(crate::util::uuid())
    .bind(item)
    .bind(v.sku.clone().unwrap_or_else(|| generate_sku(&v.name)))
    .bind(v.price)
    .bind(v.cost)
    .bind(&v.name)
    .bind(now)
    .bind(now)
    .execute(&mut *conn)
    .await?
    .last_insert_id() as i64;
    Ok(id)
}

/// Write the variants (or the item's own ingredient rows) of `item`.
async fn write_children(conn: &mut MySqlConnection, item: i64, form: &Form, now: chrono::NaiveDateTime) -> AppResult<()> {
    if !form.has_variants {
        return attach(conn, item, None, &form.ingredients).await;
    }
    for v in &form.variants {
        let attribute = match v.id {
            Some(id) => {
                sqlx::query("UPDATE food_item_attributes SET sku = ?, price = ?, cost = ?, name = ?, updated_at = ? WHERE id = ? AND food_item_id = ?")
                    .bind(v.sku.clone().unwrap_or_else(|| generate_sku(&v.name)))
                    .bind(v.price)
                    .bind(v.cost)
                    .bind(&v.name)
                    .bind(now)
                    .bind(id)
                    .bind(item)
                    .execute(&mut *conn)
                    .await?;
                id
            }
            None => insert_variant(conn, item, v, now).await?,
        };
        attach(conn, item, Some(attribute), &v.ingredients).await?;
    }
    Ok(())
}

async fn upload(state: &AppState, input: &mut Input) -> AppResult<Option<String>> {
    match input.take_file("image") {
        Some(file) => Ok(Some(crate::uploads::store_image(state, &file, IMAGE_FOLDER, "image").await?)),
        None => Ok(None),
    }
}

async fn store(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, mut input: Input) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let form = validate(&state, &input, None).await?;
    let image = upload(&state, &mut input).await?;
    let uuid = crate::util::uuid();
    let now = state.settings.get().await.now();
    let res: AppResult<()> = async {
        let mut tx = state.db.begin().await?;
        let id = sqlx::query(
            "INSERT INTO food_items (uuid, name, image, food_category_id, description, sku, price, cost, is_bar_type, has_variants, \
             tax_id, expiry_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&uuid)
        .bind(&form.name)
        .bind(&image)
        .bind(form.food_category_id)
        .bind(form.description.clone().flatten())
        .bind(&form.sku)
        .bind(form.price)
        .bind(form.cost)
        .bind(form.is_bar_type)
        .bind(form.has_variants)
        .bind(form.tax_id)
        .bind(&form.expiry_date)
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await?
        .last_insert_id() as i64;
        write_children(&mut tx, id, &form, now).await?;
        tx.commit().await?;
        Ok(())
    }
    .await;
    if let Err(e) = res {
        crate::uploads::delete(&state, image.as_deref()).await;
        return Err(e);
    }
    let msg =
        if form.has_variants { tr!("New food item with variants added successfully") } else { tr!("New food item added successfully") };
    log(&state, &user, &headers, msg, None).await;
    Ok(Json(json!({ "message": state.t("Data saved successfully").await, "item": uuid })))
}

/// Whether the update changes any column of the item (Eloquent only touches
/// `updated_at` then).
fn item_changed(row: &Map<String, Value>, form: &Form, input: &Input, image: bool) -> bool {
    let opt = |v: &Option<String>| v.clone().map(Value::from).unwrap_or(Value::Null);
    image
        || changes(&row.val("name"), &input.val("name"))
        || php_string(&row.val("food_category_id")) != php_string(&input.val("food_category_id"))
        || changes(&row.val("sku"), &Value::from(form.sku.as_str()))
        || changes(&row.val("cost"), &input.val("cost"))
        || changes(&row.val("price"), &input.val("price"))
        || form.description.as_ref().is_some_and(|d| changes(&row.val("description"), &opt(d)))
        || row.bool("is_bar_type") != form.is_bar_type
        || row.bool("has_variants") != form.has_variants
        || changes(&row.val("tax_id"), &form.tax_id.map(Value::from).unwrap_or(Value::Null))
        || changes(&row.val("expiry_date"), &opt(&form.expiry_date))
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    mut input: Input,
) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let row = find(&state, &uuid).await?;
    let id = row.i64("id");
    let form = validate(&state, &input, Some(&row)).await?;
    let image = upload(&state, &mut input).await?;
    let now = state.settings.get().await.now();
    let changed = item_changed(&row, &form, &input, image.is_some());
    let res: AppResult<()> = async {
        let mut tx = state.db.begin().await?;
        sqlx::query("DELETE FROM food_items_ingredients WHERE food_item_id = ?").bind(id).execute(&mut *tx).await?;
        write_children(&mut tx, id, &form, now).await?;
        if changed {
            let keep_description = form.description.is_none();
            sqlx::query(
                "UPDATE food_items SET name = ?, image = COALESCE(?, image), food_category_id = ?, \
                 description = IF(?, description, ?), sku = ?, price = ?, cost = ?, is_bar_type = ?, has_variants = ?, \
                 tax_id = ?, expiry_date = ?, updated_at = ? WHERE id = ?",
            )
            .bind(&form.name)
            .bind(&image)
            .bind(form.food_category_id)
            .bind(keep_description)
            .bind(form.description.clone().flatten())
            .bind(&form.sku)
            .bind(form.price)
            .bind(form.cost)
            .bind(form.is_bar_type)
            .bind(form.has_variants)
            .bind(form.tax_id)
            .bind(&form.expiry_date)
            .bind(now)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }
    .await;
    if let Err(e) = res {
        crate::uploads::delete(&state, image.as_deref()).await;
        return Err(e);
    }
    let msg = if form.has_variants { tr!("Food item with variants updated successfully") } else { tr!("Food item updated successfully") };
    log(&state, &user, &headers, msg, None).await;
    Ok(Json(json!({ "message": state.t("Data updated successfully").await })))
}

/// Delete food items with their variants and ingredient rows.
async fn remove(state: &AppState, ids: &[i64]) -> AppResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let list = vec!["?"; ids.len()].join(",");
    let args: Vec<Arg> = ids.iter().map(|i| (*i).into()).collect();
    let mut tx = state.db.begin().await?;
    for sql in [
        format!("DELETE FROM food_items_ingredients WHERE food_item_id IN ({list})"),
        format!("DELETE FROM food_item_attributes WHERE food_item_id IN ({list})"),
        format!("DELETE FROM food_items WHERE id IN ({list})"),
    ] {
        bind_all(sqlx::query(&sql), &args).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

async fn destroy(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(uuid): Path<String>) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let row = find(&state, &uuid).await?;
    remove(&state, &[row.i64("id")]).await?;
    log(&state, &user, &headers, tr!("Food item removed successfully"), None).await;
    Ok(Json(json!({ "message": state.t("Data removed successfully").await })))
}

async fn destroy_batch(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let uuids: Vec<String> = batch_rows(&input)
        .iter()
        .filter_map(|v| match v {
            Value::String(s) => Some(s.clone()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        })
        .collect();
    let mut q = Sql::new("SELECT id FROM food_items WHERE 1=1");
    q.and_in("uuid", uuids);
    let ids: Vec<i64> = q.fetch_all(&state.db).await?.iter().map(|r| r.i64("id")).collect();
    remove(&state, &ids).await?;
    for _ in &ids {
        log(&state, &user, &headers, tr!("Food item removed successfully"), None).await;
    }
    Ok(Json(json!({ "message": state.t("Data removed successfully").await })))
}

async fn destroy_attribute(
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    user.require(PERM)?;
    let Ok(id) = id.parse::<i64>() else { return Err(AppError::not_found()) };
    let found = Sql::new("SELECT id FROM food_item_attributes WHERE id = ?").push_args("", [id]).fetch_optional(&state.db).await?;
    if found.is_none() {
        return Err(AppError::not_found());
    }
    let mut tx = state.db.begin().await?;
    sqlx::query("DELETE FROM food_items_ingredients WHERE food_item_attribute_id = ?").bind(id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM food_item_attributes WHERE id = ?").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    log(&state, &user, &headers, tr!("Food item variant removed successfully"), None).await;
    Ok(Json(json!({ "message": state.t("Data removed successfully").await })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sku_shape() {
        let s = generate_sku("chicken burger");
        assert!(s.starts_with("CHI-"), "{s}");
        assert_eq!(s.len(), 10);
        assert!(s[4..].chars().all(|c| c.is_ascii_digit()));
        assert_eq!(sku_prefix("10 passengers"), "10P");
        assert_eq!(sku_prefix("a-b_c d"), "ABC");
        assert_eq!(sku_prefix("咖啡拿铁"), "咖");
        assert_eq!(sku_prefix("Té"), "TÉ");
    }

    #[test]
    fn expiry() {
        let now = crate::datefmt::parse("2026-10-18 10:00:00").unwrap();
        assert!(is_expired(Some("2026-10-18"), now));
        assert!(!is_expired(Some("2026-10-19"), now));
        assert!(!is_expired(Some("null"), now));
        assert!(!is_expired(None, now));
        assert!(!is_expired(Some("garbage"), now));
    }
}
