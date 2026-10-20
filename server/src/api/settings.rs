//! Settings screens (Settings > General, Appearance, Localization, Mail, SMS,
//! WhatsApp, Captcha, Tax, Currency, Printer, Advance, Templates...).
//!
//! Everything lives in the `settings` row (id 1), which is the only source of
//! truth: every save updates the row and reloads the in-memory settings.

use crate::{
    activity,
    auth::AuthUser,
    db::{row_json, RowExt},
    error::{AppResult, Errors},
    input::Input,
    query::{bind_all, Arg},
    state::AppState,
    uploads,
};
use axum::{
    extract::State,
    http::HeaderMap,
    middleware::from_fn,
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Map, Value};

pub fn router() -> Router<AppState> {
    let demo = || from_fn(crate::middleware::demo_mode);
    Router::new()
        .route("/admin/setting/user-roles", get(user_roles))
        .route("/admin/setting/languages", get(languages))
        .route("/admin/setting/general", get(get_general).post(set_general).route_layer(demo()))
        .route("/admin/setting/appearance", get(get_appearance).post(set_appearance).route_layer(demo()))
        .route("/admin/setting/localization", get(get_localization).post(set_localization).route_layer(demo()))
        .route("/admin/setting/setting-optimize", post(optimize))
        .route("/admin/setting/authentication", get(get_authentication).post(set_authentication).route_layer(demo()))
        .route("/admin/setting/outgoing/mail", get(get_mail).post(set_mail).route_layer(demo()))
        .route("/admin/setting/captcha", get(get_captcha).post(set_captcha).route_layer(demo()))
        .route("/admin/setting/tax", get(get_tax).post(set_tax).route_layer(demo()))
        .route("/admin/setting/currency", get(get_currency).post(set_currency).route_layer(demo()))
        .route("/admin/setting/printer", get(get_printer).post(set_printer).route_layer(demo()))
        .route("/admin/setting/advance-config", get(get_advance).post(set_advance))
        .route("/admin/setting/templates", get(get_templates).post(set_templates))
        .route("/admin/setting/sms", get(get_sms).post(set_sms).route_layer(demo()))
        .route("/admin/setting/wa", get(get_wa).post(set_wa).route_layer(demo()))
}

/* ------------------------------------------------------------------ reading */

/// Columns read back as JSON booleans (the model's boolean casts).
const BOOL_COLUMNS: &[&str] = &[
    "app_user_registration",
    "recaptcha_enabled",
    "app_https",
    "currency_symbol_on_left",
    "is_vat",
    "is_tax_fix",
    "is_tax_included",
    "signature_required",
    "print_auto",
    "sms_status",
    "wa_status",
    "advance_send_notification",
    "display_logo",
    "allow_to_edit_checked_orders",
    "disable_room_reservations",
    "elengent_search",
    "item_based_tax",
    "item_consumption_mode",
    "autoclose_service_table_model",
    "autoclose_pickup_model",
    "autoclose_customer_model",
    "autoclose_shipping_model",
    "taxation",
    "digital_menu",
    "allow_expiry_date",
    "digital_menu_require_pin",
];

/// Stored secrets: never sent back, shown as MASK when a value is stored.
const SECRET_COLUMNS: &[&str] =
    &["mail_password", "mailgun_secret", "recaptcha_private", "vonage_secret", "twilio_auth_token", "wa_twilio_auth_token"];

/// What the screens get instead of a stored secret. Saving it back keeps the
/// stored value.
pub const MASK: &str = "********";

/// A stored secret as shown to the browser: the mask when set, else as stored.
fn mask_secret(v: &Value) -> Value {
    match v {
        Value::String(s) if s.is_empty() => Value::from(""),
        Value::Null => Value::Null,
        _ => Value::from(MASK),
    }
}

/// The value a submitted secret stands for: the stored one when the mask was
/// sent back unchanged, otherwise what was submitted.
fn resolve_secret<'v>(field: &str, submitted: Option<&'v Value>, stored: Option<&'v Value>) -> Option<&'v Value> {
    match submitted {
        Some(Value::String(s)) if s == MASK && SECRET_COLUMNS.contains(&field) => stored,
        other => other,
    }
}

/// Columns holding JSON documents (notification templates).
const JSON_COLUMNS: &[&str] = &["template_order_created", "template_order_cancelled", "template_order_checkout"];

/// PHP `(bool)` of a stored value; null stays null.
fn php_bool(v: &Value) -> Value {
    match v {
        Value::Null => Value::Null,
        Value::Bool(b) => Value::Bool(*b),
        Value::Number(n) => Value::Bool(n.as_f64().map(|f| f != 0.0).unwrap_or(false)),
        Value::String(s) => Value::Bool(!(s.is_empty() || s == "0")),
        _ => Value::Bool(true),
    }
}

fn decode_json(v: &Value) -> Value {
    match v {
        Value::String(s) => serde_json::from_str(s).unwrap_or(Value::Null),
        Value::Null => Value::Null,
        other => other.clone(),
    }
}

/// One settings column as the previous API returned it.
fn present(state: &AppState, key: &str, v: &Value) -> Value {
    if SECRET_COLUMNS.contains(&key) {
        return mask_secret(v);
    }
    if BOOL_COLUMNS.contains(&key) {
        return php_bool(v);
    }
    if JSON_COLUMNS.contains(&key) {
        return decode_json(v);
    }
    match key {
        "app_icon" => Value::from(match v.as_str().filter(|s| !s.is_empty()) {
            Some(p) => state.storage_url(p),
            None => state.asset_url("images/default/icon.png"),
        }),
        "app_background" => Value::from(match v.as_str().filter(|s| !s.is_empty()) {
            Some(p) => state.storage_url(p),
            None => state.asset_url("images/default/background.png"),
        }),
        "tax_rate" => match v.as_f64() {
            Some(f) => crate::util::json_num(f),
            None => v.clone(),
        },
        _ => v.clone(),
    }
}

/// The listed settings columns, in the table's column order.
async fn pick(state: &AppState, keys: &[&str]) -> AppResult<Map<String, Value>> {
    let row = sqlx::query("SELECT * FROM settings WHERE id = 1").fetch_optional(&state.db).await?;
    let row = row.as_ref().map(row_json).unwrap_or_default();
    Ok(row.iter().filter(|(k, _)| keys.contains(&k.as_str())).map(|(k, v)| (k.clone(), present(state, k, v))).collect())
}

/* ------------------------------------------------------------------ writing */

/// How a submitted value is stored.
#[derive(Clone, Copy, PartialEq)]
enum Kind {
    /// varchar/text column
    Text,
    /// varchar/text column that cannot be NULL
    TextNotNull,
    /// tinyint flag (NOT NULL)
    Flag,
    /// varchar column holding a boolean ("1"/"0"), may be NULL
    FlagText,
    /// double column
    Number,
    /// JSON document in a text column
    Document,
}

fn to_arg(kind: Kind, v: &Value) -> Option<Arg> {
    let text = |v: &Value| match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(if *b { "1".into() } else { "0".into() }),
        Value::Null => None,
        other => Some(other.to_string()),
    };
    match kind {
        Kind::Text => Some(Arg::from(text(v))),
        Kind::TextNotNull => text(v).map(Arg::Str),
        Kind::Flag => (!v.is_null()).then(|| Arg::Bool(crate::util::truthy(v))),
        Kind::FlagText => Some(if v.is_null() { Arg::Null } else { Arg::Bool(crate::util::truthy(v)) }),
        Kind::Number => (!v.is_null()).then(|| Arg::Float(crate::util::num(v))),
        Kind::Document => {
            let doc = match v {
                Value::Null => return Some(Arg::Null),
                Value::String(s) => serde_json::from_str::<Value>(s).ok().filter(|d| d.is_object()).unwrap_or_else(|| v.clone()),
                other => other.clone(),
            };
            Some(Arg::Str(doc.to_string()))
        }
    }
}

/// Columns to save: only fields that have a rule and were sent (like the
/// previous API's `validated()` data).
#[derive(Default)]
struct Changes {
    cols: Vec<(&'static str, Arg)>,
}

impl Changes {
    fn take(&mut self, input: &Input, col: &'static str, kind: Kind) {
        if !input.present(col) {
            return;
        }
        // the mask sent back unchanged: keep the stored secret
        if SECRET_COLUMNS.contains(&col) && input.data.get(col).and_then(Value::as_str) == Some(MASK) {
            return;
        }
        if let Some(arg) = to_arg(kind, &input.val(col)) {
            self.cols.push((col, arg));
        }
    }
    fn set(&mut self, col: &'static str, arg: Arg) {
        self.cols.push((col, arg));
    }
}

/// Write the changes to the settings row and reload the cached settings.
async fn save(state: &AppState, changes: Changes) -> AppResult<()> {
    let now = state.settings.get().await.now();
    let mut sql = String::from("UPDATE settings SET ");
    let mut args = Vec::with_capacity(changes.cols.len() + 1);
    for (col, arg) in changes.cols {
        sql.push_str(&crate::db::ident(col));
        sql.push_str(" = ?, ");
        args.push(arg);
    }
    sql.push_str("updated_at = ? WHERE id = 1");
    args.push(Arg::Time(now));
    bind_all(sqlx::query(&sql), &args).execute(&state.db).await?;
    state.settings.reload(&state.db).await?;
    Ok(())
}

async fn saved(state: &AppState) -> Json<Value> {
    Json(json!({ "message": state.t("Settings updated successfully").await }))
}

/* --------------------------------------------------------------- validation */

/// Field names shown in validation messages (where they differ from the key).
fn label(field: &str) -> String {
    let named = match field {
        "app_user_registration" => tr!("user registration"),
        "app_default_role" => tr!("default role"),
        "recaptcha_enabled" => tr!("recaptcha enabled"),
        "recaptcha_public" => tr!("recaptcha public"),
        "recaptcha_private" => tr!("recaptcha private"),
        "digital_menu_require_pin" => tr!("table code"),
        "seating_pin_max_hours" => tr!("table code validity"),
        "currency_symbol" => tr!("currency symbol"),
        "app_url" => tr!("app url"),
        "app_address" => tr!("address"),
        "app_phone" => tr!("phone"),
        "app_name" => tr!("name"),
        "app_https" => tr!("is https"),
        "app_timezone" => tr!("timezone"),
        "app_locale" => tr!("locale"),
        "app_date_locale" => tr!("date locale"),
        "app_date_format" => tr!("date format"),
        "mail_from_address" => tr!("from address"),
        "mail_from_name" => tr!("from name"),
        "mail_host" => tr!("outgoing mail host"),
        "mail_port" => tr!("outgoing mail port"),
        "mail_username" => tr!("outgoing mail username"),
        "mail_password" => tr!("outgoing mail password"),
        "mailgun_domain" => tr!("mailgun domain"),
        "mailgun_secret" => tr!("mailgun secret"),
        "mailgun_endpoint" => tr!("mailgun endpoint"),
        "tax_rate" => tr!("tax rate"),
        "icon" => tr!("app icon"),
        "background" => tr!("app background"),
        _ => return field.replace('_', " "),
    };
    named.to_string()
}

/// Collects field errors with the previous API's messages, translated.
struct Check<'a> {
    state: &'a AppState,
    input: &'a Input,
    errors: Errors,
    /// Current settings, for secrets sent back as the mask
    stored: std::sync::Arc<crate::settings::Settings>,
}

fn empty(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) => s.trim().is_empty(),
        Some(Value::Array(a)) => a.is_empty(),
        _ => false,
    }
}

/// Values the `boolean` rule accepts.
fn is_boolean(v: &Value) -> bool {
    match v {
        Value::Bool(_) => true,
        Value::Number(n) => matches!(n.as_i64(), Some(0 | 1)) && !n.is_f64(),
        Value::String(s) => s == "0" || s == "1",
        _ => false,
    }
}

fn is_numeric(v: &Value) -> bool {
    match v {
        Value::Number(_) => true,
        Value::String(s) => {
            let t = s.trim_start();
            !t.is_empty() && t.len() == s.len() && s.trim_end().len() == s.len() && s.parse::<f64>().map(|f| f.is_finite()).unwrap_or(false)
        }
        _ => false,
    }
}

fn text_len(v: &Value) -> usize {
    match v {
        Value::String(s) => s.chars().count(),
        Value::Array(a) => a.len(),
        other => other.to_string().chars().count(),
    }
}

pub fn is_email(s: &str) -> bool {
    let Some((local, domain)) = s.rsplit_once('@') else { return false };
    let atext = |c: char| c.is_alphanumeric() || "!#$%&'*+-/=?^_`{|}~.".contains(c);
    let label_ok =
        |l: &str| !l.is_empty() && !l.starts_with('-') && !l.ends_with('-') && l.chars().all(|c| c.is_alphanumeric() || c == '-');
    !local.is_empty()
        && local.len() <= 64
        && local.chars().all(atext)
        && !local.starts_with('.')
        && !local.ends_with('.')
        && !local.contains("..")
        && domain.len() <= 255
        && domain.split('.').all(label_ok)
}

fn is_url(s: &str) -> bool {
    let Some((scheme, rest)) = s.split_once("://") else { return false };
    let scheme_ok = scheme.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && scheme.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = host.rsplit_once('@').map(|(_, h)| h).unwrap_or(host);
    scheme_ok && !host.is_empty() && !host.starts_with(':') && !s.chars().any(char::is_whitespace)
}

impl<'a> Check<'a> {
    async fn new(state: &'a AppState, input: &'a Input) -> Self {
        Self { state, input, errors: Errors::default(), stored: state.settings.get().await }
    }

    async fn add(&mut self, field: &str, template: &str, extra: &[(&str, &str)]) {
        let attribute = self.state.t(&label(field)).await;
        let mut params: Vec<(&str, &str)> = vec![("attribute", attribute.as_str())];
        params.extend_from_slice(extra);
        let msg = self.state.tp(template, &params).await;
        self.errors.add(field, msg);
    }

    fn value(&self, field: &str) -> Option<&Value> {
        resolve_secret(field, self.input.data.get(field), self.stored.row.get(field))
    }

    /// Present with a non-empty value; adds the "required" error otherwise.
    async fn required(&mut self, field: &str) -> bool {
        if empty(self.value(field)) {
            self.add(field, tr!("The :attribute field is required."), &[]).await;
            false
        } else {
            true
        }
    }

    /// Whether non-implicit rules run for the field (sent, and not null when nullable).
    fn runs(&self, field: &str, nullable: bool) -> bool {
        match self.value(field) {
            None => false,
            Some(Value::Null) => !nullable,
            Some(_) => true,
        }
    }

    async fn boolean(&mut self, field: &str, nullable: bool) {
        if self.runs(field, nullable) && !self.value(field).is_some_and(is_boolean) {
            self.add(field, tr!("The :attribute field must be true or false."), &[]).await;
        }
    }

    async fn max(&mut self, field: &str, max: usize, nullable: bool) {
        if self.runs(field, nullable) && self.value(field).map(text_len).unwrap_or(0) > max {
            let m = max.to_string();
            self.add(field, tr!("The :attribute may not be greater than :max characters."), &[("max", &m)]).await;
        }
    }

    async fn numeric(&mut self, field: &str) {
        if self.runs(field, false) && !self.value(field).is_some_and(is_numeric) {
            self.add(field, tr!("The :attribute must be a number."), &[]).await;
        }
    }

    async fn url(&mut self, field: &str) {
        if self.runs(field, false) && !self.value(field).and_then(Value::as_str).is_some_and(is_url) {
            self.add(field, tr!("The :attribute format is invalid."), &[]).await;
        }
    }

    async fn email(&mut self, field: &str) {
        if self.runs(field, false) && !self.value(field).and_then(Value::as_str).is_some_and(is_email) {
            self.add(field, tr!("The :attribute must be a valid email address."), &[]).await;
        }
    }

    async fn string(&mut self, field: &str) {
        if self.runs(field, false) && !self.value(field).is_some_and(Value::is_string) {
            self.add(field, tr!("The :attribute must be a string."), &[]).await;
        }
    }

    async fn invalid_selection(&mut self, field: &str) {
        self.add(field, tr!("The selected :attribute is invalid."), &[]).await;
    }

    async fn required_if(&mut self, field: &str, other: &str, other_value: &str) {
        if empty(self.value(field)) {
            let o = self.state.t(&label(other)).await;
            self.add(field, tr!("The :attribute field is required when :other is :value."), &[("other", &o), ("value", other_value)]).await;
        }
    }

    fn finish(self) -> AppResult<()> {
        self.errors.check()
    }
}

fn need(user: &AuthUser, permission: &str) -> AppResult<()> {
    user.require(&[permission])
}

/* ------------------------------------------------------------ lists (roles) */

async fn user_roles(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    need(&user, "authentication_configuration")?;
    let roles = sqlx::query("SELECT * FROM user_roles ORDER BY id").fetch_all(&state.db).await?;
    let counts =
        sqlx::query("SELECT role_id, COUNT(*) AS n FROM users WHERE role_id IS NOT NULL GROUP BY role_id").fetch_all(&state.db).await?;
    let counts: std::collections::HashMap<i64, i64> = counts.iter().map(row_json).map(|r| (r.i64("role_id"), r.i64("n"))).collect();
    let s = state.settings.get().await;
    let list: Vec<Value> = roles
        .iter()
        .map(row_json)
        .map(|r| {
            let id = r.i64("id");
            json!({
                "id": id,
                "name": r.val("name"),
                "is_primary": php_bool(&r.val("is_primary")),
                "users": counts.get(&id).copied().unwrap_or(0),
                "permissions": decode_json(&r.val("permissions")),
                "admin_access": null,
                "ordertaking_access": null,
                "kitchendisplay_access": null,
                "billingdisplay_access": null,
                "created_at": s.fmt_value(&r.val("created_at")),
                "updated_at": s.fmt_value(&r.val("updated_at")),
            })
        })
        .collect();
    Ok(Json(Value::Array(list)))
}

async fn languages(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    need(&user, "localization_configuration")?;
    let rows = sqlx::query("SELECT id, locale, name, direction FROM languages ORDER BY id").fetch_all(&state.db).await?;
    Ok(Json(Value::Array(rows.iter().map(|r| Value::Object(row_json(r))).collect())))
}

/* ------------------------------------------------------------------ general */

async fn get_general(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    need(&user, "general_configuration")?;
    let keys = ["app_url", "app_name", "app_https", "app_address", "app_phone", "mysqldump_path"];
    Ok(Json(Value::Object(pick(&state, &keys).await?)))
}

async fn set_general(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    need(&user, "general_configuration")?;
    let mut c = Check::new(&state, &input).await;
    if c.required("app_url").await {
        c.url("app_url").await;
        c.max("app_url", 255, false).await;
    }
    if c.required("app_name").await {
        c.max("app_name", 255, false).await;
    }
    c.boolean("app_https", true).await;
    c.max("app_address", 255, true).await;
    c.max("app_phone", 255, true).await;
    c.required("mysqldump_path").await;
    c.finish()?;

    let mut ch = Changes::default();
    ch.take(&input, "app_url", Kind::TextNotNull);
    ch.take(&input, "app_name", Kind::TextNotNull);
    ch.take(&input, "app_https", Kind::FlagText);
    ch.take(&input, "app_address", Kind::Text);
    ch.take(&input, "app_phone", Kind::Text);
    ch.take(&input, "mysqldump_path", Kind::TextNotNull);
    save(&state, ch).await?;
    activity::log(&state, &user, &headers, &state.t("General settings updated successfully").await, None).await;
    Ok(saved(&state).await)
}

/* --------------------------------------------------------------- appearance */

async fn get_appearance(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    need(&user, "appearance_configuration")?;
    Ok(Json(Value::Object(pick(&state, &["app_icon", "app_background"]).await?)))
}

/// Width and height of a PNG, GIF, BMP, WEBP, JPEG or ICO image.
pub fn image_size(b: &[u8]) -> Option<(u32, u32)> {
    let be16 = |i: usize| b.get(i..i + 2).map(|s| u16::from_be_bytes([s[0], s[1]]) as u32);
    let le16 = |i: usize| b.get(i..i + 2).map(|s| u16::from_le_bytes([s[0], s[1]]) as u32);
    let be32 = |i: usize| b.get(i..i + 4).map(|s| u32::from_be_bytes([s[0], s[1], s[2], s[3]]));
    let le32 = |i: usize| b.get(i..i + 4).map(|s| i32::from_le_bytes([s[0], s[1], s[2], s[3]]));
    match uploads::image_ext(b)? {
        "png" => Some((be32(16)?, be32(20)?)),
        "gif" => Some((le16(6)?, le16(8)?)),
        "bmp" => Some((le32(18)?.unsigned_abs(), le32(22)?.unsigned_abs())),
        "ico" => {
            let w = *b.get(6)? as u32;
            let h = *b.get(7)? as u32;
            Some((if w == 0 { 256 } else { w }, if h == 0 { 256 } else { h }))
        }
        "webp" => match b.get(12..16)? {
            b"VP8 " => Some((le16(26)? & 0x3fff, le16(28)? & 0x3fff)),
            b"VP8L" => {
                let v = u32::from_le_bytes([*b.get(21)?, *b.get(22)?, *b.get(23)?, *b.get(24)?]);
                Some(((v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1))
            }
            b"VP8X" => {
                let w = u32::from_le_bytes([*b.get(24)?, *b.get(25)?, *b.get(26)?, 0]) + 1;
                let h = u32::from_le_bytes([*b.get(27)?, *b.get(28)?, *b.get(29)?, 0]) + 1;
                Some((w, h))
            }
            _ => None,
        },
        "jpg" => {
            let mut i = 2;
            while i + 9 < b.len() {
                if b[i] != 0xFF {
                    i += 1;
                    continue;
                }
                let marker = b[i + 1];
                if marker == 0xFF {
                    i += 1;
                    continue;
                }
                if matches!(marker, 0xD8 | 0x01 | 0xD0..=0xD7) {
                    i += 2;
                    continue;
                }
                let len = be16(i + 2)? as usize;
                if matches!(marker, 0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF) {
                    return Some((be16(i + 7)?, be16(i + 5)?));
                }
                i += 2 + len;
            }
            None
        }
        _ => None,
    }
}

/// The `dimensions:ratio=a/b` check of the previous API.
fn ratio_ok(w: u32, h: u32, num: f64, den: f64) -> bool {
    if w == 0 || h == 0 {
        return false;
    }
    let precision = 1.0 / (w.max(h) as f64 + 1.0);
    (num / den - w as f64 / h as f64).abs() <= precision
}

async fn set_appearance(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    need(&user, "appearance_configuration")?;
    let mut c = Check::new(&state, &input).await;
    for (field, max_kb, square) in [("icon", 1000usize, true), ("background", 2000usize, false)] {
        let Some(file) = input.file(field) else { continue };
        let bytes = file.bytes().await.map_err(anyhow::Error::from)?;
        if uploads::image_ext(&bytes).is_none() {
            c.add(field, tr!("The :attribute must be an image."), &[]).await;
        }
        if file.size > max_kb * 1024 {
            let m = max_kb.to_string();
            c.add(field, tr!("The :attribute may not be greater than :max kilobytes."), &[("max", &m)]).await;
        }
        if square && !image_size(&bytes).is_some_and(|(w, h)| ratio_ok(w, h, 1.0, 1.0)) {
            c.add(field, tr!("The :attribute has invalid image dimensions."), &[]).await;
        }
    }
    c.finish()?;

    let mut ch = Changes::default();
    if let Some(file) = input.file("icon") {
        let path = uploads::store_image(&state, file, "appearance/icon", "icon").await?;
        ch.set("app_icon", Arg::Str(path));
    }
    if let Some(file) = input.file("background") {
        let path = uploads::store_image(&state, file, "appearance/background", "background").await?;
        ch.set("app_background", Arg::Str(path));
    }
    save(&state, ch).await?;
    activity::log(&state, &user, &headers, &state.t("Appearance settings updated successfully").await, None).await;
    Ok(saved(&state).await)
}

/* ------------------------------------------------------------- localization */

pub fn timezones() -> Vec<&'static str> {
    PHP_TIMEZONES.split_whitespace().collect()
}

async fn get_localization(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    need(&user, "localization_configuration")?;
    let data = pick(&state, &["app_timezone", "app_locale", "app_date_locale", "app_date_format", "app_direction"]).await?;
    Ok(Json(json!({ "timezones": timezones(), "data": data })))
}

async fn set_localization(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    need(&user, "localization_configuration")?;
    let mut c = Check::new(&state, &input).await;
    if c.required("app_timezone").await {
        c.max("app_timezone", 255, false).await;
        let tz = input.string("app_timezone");
        if tz.parse::<chrono_tz::Tz>().is_err() {
            c.add("app_timezone", tr!("The :attribute must be a valid zone."), &[]).await;
        }
    }
    if c.required("app_locale").await {
        let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM languages WHERE locale = ? LIMIT 1")
            .bind(input.string("app_locale"))
            .fetch_optional(&state.db)
            .await?;
        if exists.is_none() {
            c.invalid_selection("app_locale").await;
        }
        c.max("app_locale", 255, false).await;
    }
    for f in ["app_date_locale", "app_date_format", "app_direction"] {
        if c.required(f).await {
            c.max(f, 255, false).await;
        }
    }
    c.finish()?;

    let mut ch = Changes::default();
    for f in ["app_timezone", "app_locale", "app_date_locale", "app_date_format", "app_direction"] {
        ch.take(&input, f, Kind::TextNotNull);
    }
    save(&state, ch).await?;
    activity::log(&state, &user, &headers, &state.t("Localization settings updated successfully").await, None).await;
    Ok(saved(&state).await)
}

/* ----------------------------------------------------------------- optimize */

/// Settings > General > System maintenance. Settings and translations are
/// read again from the database and the language files; "update" also runs
/// the schema check and "sync" rebuilds the per-item sale records.
async fn optimize(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    need(&user, "general_configuration")?;
    let action = input.string("action");
    let mut output = String::new();
    match action.as_str() {
        "update" => {
            let _guard = state.maintenance.lock().await;
            let report = crate::bootstrap::run(&state.db, &state.cfg).await?;
            for m in &report.migrated {
                output.push_str(&format!("Applied database update {m}\n"));
            }
            output.push_str(&state.t("Update completed successfully").await);
            output.push('\n');
        }
        "sync" => output.push_str(&sync_sale_records(&state).await?),
        _ => {}
    }
    state.settings.reload(&state.db).await?;
    let langs = reload_translations(&state).await;
    if matches!(action.as_str(), "optimize" | "cache" | "opt" | "storage_link" | "update") {
        output.push_str(&state.tp("Settings reloaded. :count translation files reloaded.", &[("count", &langs.to_string())]).await);
        output.push('\n');
    }
    Ok(Json(json!({ "message": state.t("System performed successfully").await, "output": output })))
}

/// Merge new strings into the translation files and drop the cached copies,
/// so the files are read again; returns how many translation files there are.
pub async fn reload_translations(state: &AppState) -> usize {
    if let Err(e) = state.lang.init().await {
        tracing::warn!(error = %e, "could not merge translation files");
    }
    state.lang.clear_cache().await;
    let mut n = 0;
    let Ok(mut rd) = tokio::fs::read_dir(state.lang.dir()).await else { return 0 };
    while let Ok(Some(entry)) = rd.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.strip_suffix(".json").is_some_and(crate::i18n::Lang::valid_locale) {
            n += 1;
        }
    }
    n
}

/// Rebuild `sale_items` from each sale's stored item list (used by reports).
async fn sync_sale_records(state: &AppState) -> AppResult<String> {
    let _guard = state.maintenance.lock().await;
    let foods: std::collections::HashMap<i64, (String, Value)> = sqlx::query("SELECT id, name, food_category_id FROM food_items")
        .fetch_all(&state.db)
        .await?
        .iter()
        .map(row_json)
        .map(|r| (r.i64("id"), (r.str("name"), r.val("food_category_id"))))
        .collect();
    let attrs: std::collections::HashMap<i64, String> = sqlx::query("SELECT id, name FROM food_item_attributes")
        .fetch_all(&state.db)
        .await?
        .iter()
        .map(row_json)
        .map(|r| (r.i64("id"), r.str("name")))
        .collect();
    let (mut ok, mut failed, mut missing) = (0u64, 0u64, 0u64);
    let mut last_id = 0i64;
    loop {
        let sales = sqlx::query("SELECT id, items, created_at, updated_at FROM sales WHERE id > ? ORDER BY id LIMIT 200")
            .bind(last_id)
            .fetch_all(&state.db)
            .await?;
        if sales.is_empty() {
            break;
        }
        for sale in sales.iter().map(row_json) {
            let id = sale.i64("id");
            last_id = id;
            let items = decode_json(&sale.val("items"));
            let mut rows: Vec<Vec<Arg>> = vec![];
            for item in items.as_array().map(Vec::as_slice).unwrap_or_default() {
                let has = |k: &str| item.get(k).is_some_and(|v| !v.is_null());
                if !(has("id") && has("name") && has("qty") && has("price") && has("sub_total")) {
                    continue;
                }
                let item_id = crate::util::num(&item["id"]) as i64;
                let variant_of = item.get("food_item_id").filter(|v| crate::util::num(v) != 0.0).map(|v| crate::util::num(v) as i64);
                let (food_id, attr_id, data) = match variant_of {
                    Some(fid) => match (foods.get(&fid), attrs.get(&item_id)) {
                        (Some(_), Some(name)) => (fid, Some(item_id), json!({ "id": item_id, "name": name })),
                        _ => {
                            missing += 1;
                            continue;
                        }
                    },
                    None => match foods.get(&item_id) {
                        Some((name, _)) => (item_id, None, json!({ "id": item_id, "name": name })),
                        None => {
                            missing += 1;
                            continue;
                        }
                    },
                };
                let category = foods.get(&food_id).map(|f| Arg::from(&f.1)).unwrap_or(Arg::Null);
                rows.push(vec![
                    Arg::Int(id),
                    Arg::Str(data.to_string()),
                    Arg::from(&item["name"]),
                    Arg::from(&item["qty"]),
                    Arg::from(&item["price"]),
                    Arg::Float(crate::util::round(crate::util::num(&item["sub_total"]), 2)),
                    Arg::Int(food_id),
                    Arg::from(attr_id),
                    category,
                    Arg::from(&sale.val("created_at")),
                    Arg::from(&sale.val("updated_at")),
                ]);
            }
            let result: Result<(), sqlx::Error> = async {
                let mut tx = state.db.begin().await?;
                sqlx::query("DELETE FROM sale_items WHERE sale_id = ?").bind(id).execute(&mut *tx).await?;
                for r in &rows {
                    bind_all(
                        sqlx::query(
                            "INSERT INTO sale_items (sale_id, item_data, item_name, quantity, price, total_amount, food_item_id, food_item_attribute_id, food_category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        ),
                        r,
                    )
                    .execute(&mut *tx)
                    .await?;
                }
                tx.commit().await
            }
            .await;
            match result {
                Ok(()) => ok += 1,
                Err(e) => {
                    failed += 1;
                    tracing::warn!(sale = id, error = %e, "could not rebuild the sale's item records");
                }
            }
        }
    }
    Ok(format!(
        "{}\n{}: {ok}\n{}: {failed}\n{}: {missing}\n",
        state.t("Synchronization completed.").await,
        state.t("Successful Sales Synced").await,
        state.t("Failed Sales").await,
        state.t("Missing Products").await
    ))
}

/* ----------------------------------------------------------- authentication */

async fn get_authentication(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    need(&user, "authentication_configuration")?;
    Ok(Json(Value::Object(pick(&state, &["app_user_registration", "app_default_role"]).await?)))
}

async fn set_authentication(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    need(&user, "authentication_configuration")?;
    let mut c = Check::new(&state, &input).await;
    if c.required("app_user_registration").await {
        c.boolean("app_user_registration", false).await;
    }
    if c.required("app_default_role").await {
        let id = input.str("app_default_role").unwrap_or_default();
        let exists: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM user_roles WHERE id = ? LIMIT 1").bind(&id).fetch_optional(&state.db).await?;
        if exists.is_none() {
            c.invalid_selection("app_default_role").await;
        }
    }
    c.finish()?;
    let mut ch = Changes::default();
    ch.take(&input, "app_user_registration", Kind::Flag);
    ch.take(&input, "app_default_role", Kind::TextNotNull);
    save(&state, ch).await?;
    activity::log(&state, &user, &headers, &state.t("Authentication settings updated successfully").await, None).await;
    Ok(saved(&state).await)
}

/* ------------------------------------------------------------ outgoing mail */

const MAIL_KEYS: [&str; 12] = [
    "mail_from_address",
    "mail_from_name",
    "mail_mailer",
    "mail_encryption",
    "mail_host",
    "mail_password",
    "mail_port",
    "mail_username",
    "mailgun_domain",
    "mailgun_secret",
    "mailgun_endpoint",
    "queue_connection",
];

async fn get_mail(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    need(&user, "outgoing_mail_configuration")?;
    let data = pick(&state, &MAIL_KEYS).await?;
    // No scheduler to set up: mail is sent in the background by the server.
    Ok(Json(json!({ "data": data, "command_1": null, "command_2": null })))
}

async fn set_mail(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    need(&user, "outgoing_mail_configuration")?;
    let mailer = input.data.get("mail_mailer").and_then(Value::as_str).unwrap_or("").to_string();
    let mut c = Check::new(&state, &input).await;
    c.required("mail_mailer").await;
    if c.required("mail_from_address").await {
        c.email("mail_from_address").await;
        c.max("mail_from_address", 255, false).await;
    }
    if c.required("mail_from_name").await {
        c.max("mail_from_name", 255, false).await;
    }
    c.required("queue_connection").await;
    if mailer == "smtp" {
        if c.required("mail_host").await {
            c.max("mail_host", 255, false).await;
        }
        if c.required("mail_port").await {
            c.numeric("mail_port").await;
        }
        if c.required("mail_username").await {
            c.max("mail_username", 255, false).await;
        }
        c.required("mail_password").await;
        c.required("mail_encryption").await;
    }
    if mailer == "mailgun" {
        for f in ["mailgun_domain", "mailgun_secret", "mailgun_endpoint"] {
            c.required(f).await;
        }
    }
    c.finish()?;

    let mut ch = Changes::default();
    ch.take(&input, "mail_mailer", Kind::TextNotNull);
    ch.take(&input, "mail_from_address", Kind::Text);
    ch.take(&input, "mail_from_name", Kind::TextNotNull);
    ch.take(&input, "queue_connection", Kind::TextNotNull);
    if mailer == "smtp" {
        ch.take(&input, "mail_host", Kind::Text);
        ch.take(&input, "mail_port", Kind::TextNotNull);
        ch.take(&input, "mail_username", Kind::Text);
        ch.take(&input, "mail_password", Kind::Text);
        ch.take(&input, "mail_encryption", Kind::Text);
    }
    if mailer == "mailgun" {
        ch.take(&input, "mailgun_domain", Kind::Text);
        ch.take(&input, "mailgun_secret", Kind::Text);
        ch.take(&input, "mailgun_endpoint", Kind::Text);
    }
    save(&state, ch).await?;
    activity::log(&state, &user, &headers, &state.t("Outgoing mail settings updated successfully").await, None).await;
    Ok(saved(&state).await)
}

/* ------------------------------------------------------------------ captcha */

async fn get_captcha(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    need(&user, "captcha_configuration")?;
    Ok(Json(Value::Object(pick(&state, &["recaptcha_enabled", "recaptcha_public", "recaptcha_private"]).await?)))
}

async fn set_captcha(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    need(&user, "captcha_configuration")?;
    let mut c = Check::new(&state, &input).await;
    if c.required("recaptcha_enabled").await {
        c.boolean("recaptcha_enabled", false).await;
    }
    // required_if:recaptcha_enabled,true; the boolean field compares loosely
    // with true, so any truthy value counts
    let other = input.data.get("recaptcha_enabled");
    if php_truthy(other) {
        let shown = match other {
            Some(Value::Bool(b)) => b.to_string(),
            Some(Value::String(s)) => s.clone(),
            Some(v) => v.to_string(),
            None => String::new(),
        };
        c.required_if("recaptcha_public", "recaptcha_enabled", &shown).await;
        c.required_if("recaptcha_private", "recaptcha_enabled", &shown).await;
    }
    c.finish()?;
    let mut ch = Changes::default();
    ch.take(&input, "recaptcha_enabled", Kind::Flag);
    ch.take(&input, "recaptcha_public", Kind::Text);
    ch.take(&input, "recaptcha_private", Kind::Text);
    save(&state, ch).await?;
    activity::log(&state, &user, &headers, &state.t("Google captcha settings updated successfully").await, None).await;
    Ok(saved(&state).await)
}

/* ---------------------------------------------------------------------- tax */

async fn get_tax(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    need(&user, "tax_configuration")?;
    let keys = ["tax_rate", "is_tax_fix", "is_tax_included", "tax_id", "is_vat", "tax_title", "vat_number"];
    Ok(Json(Value::Object(pick(&state, &keys).await?)))
}

async fn set_tax(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    need(&user, "tax_configuration")?;
    let mut c = Check::new(&state, &input).await;
    if c.required("tax_title").await {
        c.string("tax_title").await;
        c.max("tax_title", 50, false).await;
    }
    if c.required("tax_rate").await {
        c.numeric("tax_rate").await;
    }
    c.boolean("is_tax_included", false).await;
    c.boolean("is_tax_fix", false).await;
    c.required("is_vat").await;
    c.finish()?;
    let mut ch = Changes::default();
    ch.take(&input, "tax_title", Kind::TextNotNull);
    ch.take(&input, "tax_rate", Kind::Number);
    ch.take(&input, "is_tax_included", Kind::Flag);
    ch.take(&input, "is_tax_fix", Kind::Flag);
    ch.take(&input, "tax_id", Kind::TextNotNull);
    ch.take(&input, "is_vat", Kind::Flag);
    ch.take(&input, "vat_number", Kind::Text);
    save(&state, ch).await?;
    activity::log(&state, &user, &headers, &state.t("Tax settings updated successfully").await, None).await;
    Ok(saved(&state).await)
}

/* ----------------------------------------------------------------- currency */

async fn get_currency(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    need(&user, "currency_configuration")?;
    Ok(Json(Value::Object(pick(&state, &["currency_symbol_on_left", "currency_symbol"]).await?)))
}

async fn set_currency(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    need(&user, "currency_configuration")?;
    let mut c = Check::new(&state, &input).await;
    if c.required("currency_symbol").await {
        c.max("currency_symbol", 10, false).await;
    }
    if c.required("currency_symbol_on_left").await {
        c.boolean("currency_symbol_on_left", false).await;
    }
    c.finish()?;
    let mut ch = Changes::default();
    ch.take(&input, "currency_symbol", Kind::TextNotNull);
    ch.take(&input, "currency_symbol_on_left", Kind::Flag);
    save(&state, ch).await?;
    activity::log(&state, &user, &headers, &state.t("Currency settings updated successfully").await, None).await;
    Ok(saved(&state).await)
}

/* ------------------------------------------------------------------ printer */

const PRINTER_TEXT: [&str; 9] = [
    "print_font_family",
    "print_name_address_position",
    "print_name_address_size",
    "print_header_footer_size",
    "print_items_font_size",
    "print_terms_conditions_font_size",
    "print_font_color",
    "printer_width",
    "printer_height",
];

async fn get_printer(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    need(&user, "printer_configuration")?;
    let mut keys: Vec<&str> = PRINTER_TEXT.to_vec();
    keys.extend(["signature_required", "terms_conditions", "print_auto", "invoice_type_title", "display_logo"]);
    Ok(Json(Value::Object(pick(&state, &keys).await?)))
}

async fn set_printer(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    need(&user, "printer_configuration")?;
    let mut c = Check::new(&state, &input).await;
    for f in PRINTER_TEXT {
        c.required(f).await;
    }
    if c.required("signature_required").await {
        c.boolean("signature_required", false).await;
    }
    if c.required("print_auto").await {
        c.boolean("print_auto", false).await;
    }
    c.finish()?;
    let mut ch = Changes::default();
    for f in PRINTER_TEXT {
        ch.take(&input, f, Kind::TextNotNull);
    }
    ch.take(&input, "signature_required", Kind::Flag);
    ch.take(&input, "terms_conditions", Kind::Text);
    ch.take(&input, "print_auto", Kind::Flag);
    ch.take(&input, "invoice_type_title", Kind::Text);
    ch.take(&input, "display_logo", Kind::Flag);
    save(&state, ch).await?;
    activity::log(&state, &user, &headers, &state.t("Printing settings updated successfully").await, None).await;
    Ok(saved(&state).await)
}

/* ------------------------------------------------------------------ advance */

const ADVANCE_REQUIRED: [&str; 18] = [
    "advance_cashbook_mode",
    "advance_print_on_submit",
    "advance_customer_tip_collection",
    "advance_send_notification",
    "bypass_kitchen_bar",
    "allow_table_reselect",
    "table_is_option",
    "allow_to_edit_checked_orders",
    "disable_room_reservations",
    "elengent_search",
    "item_based_tax",
    "autoclose_service_table_model",
    "autoclose_pickup_model",
    "autoclose_customer_model",
    "autoclose_shipping_model",
    "item_consumption_mode",
    "taxation",
    "digital_menu",
];

async fn get_advance(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    need(&user, "advance_configuration")?;
    let mut keys: Vec<&str> = ADVANCE_REQUIRED.to_vec();
    keys.extend(["allow_expiry_date", "digital_menu_require_pin", "seating_pin_max_hours"]);
    Ok(Json(Value::Object(pick(&state, &keys).await?)))
}

async fn set_advance(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    need(&user, "advance_configuration")?;
    let mut c = Check::new(&state, &input).await;
    for f in ADVANCE_REQUIRED {
        c.required(f).await;
    }
    c.boolean("allow_expiry_date", false).await;
    c.boolean("digital_menu_require_pin", false).await;
    let max_hours = input.get("seating_pin_max_hours").filter(|v| !v.is_null()).map(crate::util::num);
    if max_hours.is_some_and(|h| h.fract() != 0.0 || !(1.0..=72.0).contains(&h)) {
        c.add("seating_pin_max_hours", tr!("The :attribute must be between :min and :max."), &[("min", "1"), ("max", "72")]).await;
    }
    c.finish()?;
    let mut ch = Changes::default();
    for f in ADVANCE_REQUIRED {
        ch.take(&input, f, Kind::Flag);
    }
    ch.take(&input, "allow_expiry_date", Kind::Flag);
    ch.take(&input, "digital_menu_require_pin", Kind::Flag);
    if let Some(h) = max_hours {
        ch.set("seating_pin_max_hours", Arg::Int(h as i64));
    }
    save(&state, ch).await?;
    activity::log(&state, &user, &headers, &state.t("Advance settings updated successfully").await, None).await;
    Ok(saved(&state).await)
}

/* ---------------------------------------------------------------- templates */

async fn get_templates(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    need(&user, "notification_templates")?;
    Ok(Json(Value::Object(pick(&state, JSON_COLUMNS).await?)))
}

async fn set_templates(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    need(&user, "notification_templates")?;
    let mut c = Check::new(&state, &input).await;
    for f in JSON_COLUMNS {
        c.required(f).await;
    }
    c.finish()?;
    let mut ch = Changes::default();
    for f in JSON_COLUMNS {
        ch.take(&input, f, Kind::Document);
    }
    save(&state, ch).await?;
    Ok(saved(&state).await)
}

/* ---------------------------------------------------------------------- SMS */

async fn get_sms(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    need(&user, "sms_configuration")?;
    let keys = [
        "sms_status",
        "sms_channel",
        "vonage_key",
        "vonage_secret",
        "vonage_from",
        "twilio_account_sid",
        "twilio_auth_token",
        "twilio_from",
    ];
    Ok(Json(Value::Object(pick(&state, &keys).await?)))
}

/// PHP truthiness of a request value (`if (request('x'))`).
fn php_truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0),
        Some(Value::String(s)) => !(s.is_empty() || s == "0"),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Object(_)) => true,
    }
}

async fn set_sms(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    need(&user, "sms_configuration")?;
    let on = php_truthy(input.data.get("sms_status"));
    let channel = input.data.get("sms_channel").map(|v| match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    });
    let group: &[&'static str] = match (on, channel.as_deref()) {
        (true, Some("nexmo")) => &["vonage_key", "vonage_secret", "vonage_from"],
        (true, Some("twilio")) => &["twilio_account_sid", "twilio_auth_token", "twilio_from"],
        _ => &[],
    };
    let mut c = Check::new(&state, &input).await;
    c.required("sms_status").await;
    for f in group {
        c.required(f).await;
    }
    c.finish()?;
    let mut ch = Changes::default();
    ch.take(&input, "sms_status", Kind::Flag);
    ch.take(&input, "sms_channel", Kind::Text);
    for f in group {
        ch.take(&input, f, Kind::Text);
    }
    save(&state, ch).await?;
    Ok(saved(&state).await)
}

/* ----------------------------------------------------------------- WhatsApp */

async fn get_wa(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    need(&user, "whatsapp_configuration")?;
    let keys = ["wa_status", "wa_twilio_account_sid", "wa_twilio_auth_token", "wa_twilio_from"];
    Ok(Json(Value::Object(pick(&state, &keys).await?)))
}

async fn set_wa(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    need(&user, "whatsapp_configuration")?;
    let on = input.bool("wa_status");
    let group: &[&'static str] = if on { &["wa_twilio_account_sid", "wa_twilio_auth_token", "wa_twilio_from"] } else { &[] };
    let mut c = Check::new(&state, &input).await;
    c.required("wa_status").await;
    for f in group {
        c.required(f).await;
    }
    c.finish()?;
    let mut ch = Changes::default();
    ch.take(&input, "wa_status", Kind::Flag);
    for f in group {
        ch.take(&input, f, Kind::Text);
    }
    save(&state, ch).await?;
    Ok(saved(&state).await)
}

/// Time zones offered by Settings > Localization (the previous release's list).
const PHP_TIMEZONES: &str = "\
    Africa/Abidjan Africa/Accra Africa/Addis_Ababa Africa/Algiers Africa/Asmara Africa/Bamako \
    Africa/Bangui Africa/Banjul Africa/Bissau Africa/Blantyre Africa/Brazzaville Africa/Bujumbura \
    Africa/Cairo Africa/Casablanca Africa/Ceuta Africa/Conakry Africa/Dakar Africa/Dar_es_Salaam \
    Africa/Djibouti Africa/Douala Africa/El_Aaiun Africa/Freetown Africa/Gaborone Africa/Harare \
    Africa/Johannesburg Africa/Juba Africa/Kampala Africa/Khartoum Africa/Kigali Africa/Kinshasa \
    Africa/Lagos Africa/Libreville Africa/Lome Africa/Luanda Africa/Lubumbashi Africa/Lusaka \
    Africa/Malabo Africa/Maputo Africa/Maseru Africa/Mbabane Africa/Mogadishu Africa/Monrovia \
    Africa/Nairobi Africa/Ndjamena Africa/Niamey Africa/Nouakchott Africa/Ouagadougou Africa/Porto-Novo \
    Africa/Sao_Tome Africa/Tripoli Africa/Tunis Africa/Windhoek America/Adak America/Anchorage \
    America/Anguilla America/Antigua America/Araguaina America/Argentina/Buenos_Aires \
    America/Argentina/Catamarca America/Argentina/Cordoba America/Argentina/Jujuy \
    America/Argentina/La_Rioja America/Argentina/Mendoza America/Argentina/Rio_Gallegos \
    America/Argentina/Salta America/Argentina/San_Juan America/Argentina/San_Luis \
    America/Argentina/Tucuman America/Argentina/Ushuaia America/Aruba America/Asuncion America/Atikokan \
    America/Bahia America/Bahia_Banderas America/Barbados America/Belem America/Belize \
    America/Blanc-Sablon America/Boa_Vista America/Bogota America/Boise America/Cambridge_Bay \
    America/Campo_Grande America/Cancun America/Caracas America/Cayenne America/Cayman America/Chicago \
    America/Chihuahua America/Ciudad_Juarez America/Costa_Rica America/Coyhaique America/Creston \
    America/Cuiaba America/Curacao America/Danmarkshavn America/Dawson America/Dawson_Creek \
    America/Denver America/Detroit America/Dominica America/Edmonton America/Eirunepe \
    America/El_Salvador America/Fort_Nelson America/Fortaleza America/Glace_Bay America/Goose_Bay \
    America/Grand_Turk America/Grenada America/Guadeloupe America/Guatemala America/Guayaquil \
    America/Guyana America/Halifax America/Havana America/Hermosillo America/Indiana/Indianapolis \
    America/Indiana/Knox America/Indiana/Marengo America/Indiana/Petersburg America/Indiana/Tell_City \
    America/Indiana/Vevay America/Indiana/Vincennes America/Indiana/Winamac America/Inuvik \
    America/Iqaluit America/Jamaica America/Juneau America/Kentucky/Louisville \
    America/Kentucky/Monticello America/Kralendijk America/La_Paz America/Lima America/Los_Angeles \
    America/Lower_Princes America/Maceio America/Managua America/Manaus America/Marigot \
    America/Martinique America/Matamoros America/Mazatlan America/Menominee America/Merida \
    America/Metlakatla America/Mexico_City America/Miquelon America/Moncton America/Monterrey \
    America/Montevideo America/Montserrat America/Nassau America/New_York America/Nome America/Noronha \
    America/North_Dakota/Beulah America/North_Dakota/Center America/North_Dakota/New_Salem America/Nuuk \
    America/Ojinaga America/Panama America/Paramaribo America/Phoenix America/Port-au-Prince \
    America/Port_of_Spain America/Porto_Velho America/Puerto_Rico America/Punta_Arenas \
    America/Rankin_Inlet America/Recife America/Regina America/Resolute America/Rio_Branco \
    America/Santarem America/Santiago America/Santo_Domingo America/Sao_Paulo America/Scoresbysund \
    America/Sitka America/St_Barthelemy America/St_Johns America/St_Kitts America/St_Lucia \
    America/St_Thomas America/St_Vincent America/Swift_Current America/Tegucigalpa America/Thule \
    America/Tijuana America/Toronto America/Tortola America/Vancouver America/Whitehorse \
    America/Winnipeg America/Yakutat Antarctica/Casey Antarctica/Davis Antarctica/DumontDUrville \
    Antarctica/Macquarie Antarctica/Mawson Antarctica/McMurdo Antarctica/Palmer Antarctica/Rothera \
    Antarctica/Syowa Antarctica/Troll Antarctica/Vostok Arctic/Longyearbyen Asia/Aden Asia/Almaty \
    Asia/Amman Asia/Anadyr Asia/Aqtau Asia/Aqtobe Asia/Ashgabat Asia/Atyrau Asia/Baghdad Asia/Bahrain \
    Asia/Baku Asia/Bangkok Asia/Barnaul Asia/Beirut Asia/Bishkek Asia/Brunei Asia/Chita Asia/Colombo \
    Asia/Damascus Asia/Dhaka Asia/Dili Asia/Dubai Asia/Dushanbe Asia/Famagusta Asia/Gaza Asia/Hebron \
    Asia/Ho_Chi_Minh Asia/Hong_Kong Asia/Hovd Asia/Irkutsk Asia/Jakarta Asia/Jayapura Asia/Jerusalem \
    Asia/Kabul Asia/Kamchatka Asia/Karachi Asia/Kathmandu Asia/Khandyga Asia/Kolkata Asia/Krasnoyarsk \
    Asia/Kuala_Lumpur Asia/Kuching Asia/Kuwait Asia/Macau Asia/Magadan Asia/Makassar Asia/Manila \
    Asia/Muscat Asia/Nicosia Asia/Novokuznetsk Asia/Novosibirsk Asia/Omsk Asia/Oral Asia/Phnom_Penh \
    Asia/Pontianak Asia/Pyongyang Asia/Qatar Asia/Qostanay Asia/Qyzylorda Asia/Riyadh Asia/Sakhalin \
    Asia/Samarkand Asia/Seoul Asia/Shanghai Asia/Singapore Asia/Srednekolymsk Asia/Taipei Asia/Tashkent \
    Asia/Tbilisi Asia/Tehran Asia/Thimphu Asia/Tokyo Asia/Tomsk Asia/Ulaanbaatar Asia/Urumqi \
    Asia/Ust-Nera Asia/Vientiane Asia/Vladivostok Asia/Yakutsk Asia/Yangon Asia/Yekaterinburg \
    Asia/Yerevan Atlantic/Azores Atlantic/Bermuda Atlantic/Canary Atlantic/Cape_Verde Atlantic/Faroe \
    Atlantic/Madeira Atlantic/Reykjavik Atlantic/South_Georgia Atlantic/St_Helena Atlantic/Stanley \
    Australia/Adelaide Australia/Brisbane Australia/Broken_Hill Australia/Darwin Australia/Eucla \
    Australia/Hobart Australia/Lindeman Australia/Lord_Howe Australia/Melbourne Australia/Perth \
    Australia/Sydney Europe/Amsterdam Europe/Andorra Europe/Astrakhan Europe/Athens Europe/Belgrade \
    Europe/Berlin Europe/Bratislava Europe/Brussels Europe/Bucharest Europe/Budapest Europe/Busingen \
    Europe/Chisinau Europe/Copenhagen Europe/Dublin Europe/Gibraltar Europe/Guernsey Europe/Helsinki \
    Europe/Isle_of_Man Europe/Istanbul Europe/Jersey Europe/Kaliningrad Europe/Kirov Europe/Kyiv \
    Europe/Lisbon Europe/Ljubljana Europe/London Europe/Luxembourg Europe/Madrid Europe/Malta \
    Europe/Mariehamn Europe/Minsk Europe/Monaco Europe/Moscow Europe/Oslo Europe/Paris Europe/Podgorica \
    Europe/Prague Europe/Riga Europe/Rome Europe/Samara Europe/San_Marino Europe/Sarajevo Europe/Saratov \
    Europe/Simferopol Europe/Skopje Europe/Sofia Europe/Stockholm Europe/Tallinn Europe/Tirane \
    Europe/Ulyanovsk Europe/Vaduz Europe/Vatican Europe/Vienna Europe/Vilnius Europe/Volgograd \
    Europe/Warsaw Europe/Zagreb Europe/Zurich Indian/Antananarivo Indian/Chagos Indian/Christmas \
    Indian/Cocos Indian/Comoro Indian/Kerguelen Indian/Mahe Indian/Maldives Indian/Mauritius \
    Indian/Mayotte Indian/Reunion Pacific/Apia Pacific/Auckland Pacific/Bougainville Pacific/Chatham \
    Pacific/Chuuk Pacific/Easter Pacific/Efate Pacific/Fakaofo Pacific/Fiji Pacific/Funafuti \
    Pacific/Galapagos Pacific/Gambier Pacific/Guadalcanal Pacific/Guam Pacific/Honolulu Pacific/Kanton \
    Pacific/Kiritimati Pacific/Kosrae Pacific/Kwajalein Pacific/Majuro Pacific/Marquesas Pacific/Midway \
    Pacific/Nauru Pacific/Niue Pacific/Norfolk Pacific/Noumea Pacific/Pago_Pago Pacific/Palau \
    Pacific/Pitcairn Pacific/Pohnpei Pacific/Port_Moresby Pacific/Rarotonga Pacific/Saipan \
    Pacific/Tahiti Pacific/Tarawa Pacific/Tongatapu Pacific/Wake Pacific/Wallis UTC ";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn booleans_like_before() {
        assert!(is_boolean(&json!(true)));
        assert!(is_boolean(&json!(0)));
        assert!(is_boolean(&json!("1")));
        assert!(!is_boolean(&json!("true")));
        assert!(!is_boolean(&json!(2)));
        assert!(!is_boolean(&json!(1.0)));
        assert_eq!(php_bool(&json!("0")), json!(false));
        assert_eq!(php_bool(&json!("1")), json!(true));
        assert_eq!(php_bool(&Value::Null), Value::Null);
    }

    #[test]
    fn secrets_are_masked() {
        assert_eq!(mask_secret(&json!("hunter2")), json!(MASK));
        assert_eq!(mask_secret(&json!("")), json!(""));
        assert_eq!(mask_secret(&Value::Null), Value::Null);
    }

    #[test]
    fn mask_keeps_stored_secret() {
        let stored = json!("real-token");
        let mask = json!(MASK);
        let new = json!("new-token");
        // mask sent back: stands for what is stored (or nothing)
        assert_eq!(resolve_secret("twilio_auth_token", Some(&mask), Some(&stored)), Some(&stored));
        assert!(empty(resolve_secret("twilio_auth_token", Some(&mask), None)));
        assert!(empty(resolve_secret("twilio_auth_token", Some(&mask), Some(&Value::Null))));
        // a new value or a non-secret field is taken as sent
        assert_eq!(resolve_secret("twilio_auth_token", Some(&new), Some(&stored)), Some(&new));
        assert_eq!(resolve_secret("twilio_from", Some(&mask), Some(&stored)), Some(&mask));
    }

    #[test]
    fn mask_is_not_saved() {
        let input = Input {
            data: serde_json::from_value(json!({ "mail_password": MASK, "mail_host": "h", "wa_twilio_auth_token": "new" })).unwrap(),
            files: vec![],
        };
        let mut ch = Changes::default();
        ch.take(&input, "mail_password", Kind::Text);
        ch.take(&input, "mail_host", Kind::Text);
        ch.take(&input, "wa_twilio_auth_token", Kind::Text);
        let cols: Vec<&str> = ch.cols.iter().map(|(c, _)| *c).collect();
        assert_eq!(cols, vec!["mail_host", "wa_twilio_auth_token"]);
    }

    #[test]
    fn email_and_url() {
        assert!(is_email("a.b@example.com"));
        assert!(!is_email("bad"));
        assert!(!is_email("a@b..c"));
        assert!(is_email("x@localhost"));
        assert!(!is_email("set_your_mail@your_domain.com"));
        assert!(is_url("https://pos.example.com"));
        assert!(is_url("http://localhost:8000/x"));
        assert!(!is_url("notaurl"));
        assert!(!is_url("http://"));
    }

    #[test]
    fn numeric_strings() {
        assert!(is_numeric(&json!("12.5")));
        assert!(is_numeric(&json!(3)));
        assert!(!is_numeric(&json!("abc")));
        assert!(!is_numeric(&json!(" 1")));
    }

    #[test]
    fn timezones_parse() {
        let list = timezones();
        assert_eq!(list.len(), 419);
        for tz in list {
            assert!(tz.parse::<chrono_tz::Tz>().is_ok(), "{tz}");
        }
    }

    #[test]
    fn square_ratio() {
        assert!(ratio_ok(512, 512, 1.0, 1.0));
        assert!(!ratio_ok(512, 400, 1.0, 1.0));
    }

    #[test]
    fn png_size() {
        let mut png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, b'I', b'H', b'D', b'R'];
        png.extend(300u32.to_be_bytes());
        png.extend(200u32.to_be_bytes());
        assert_eq!(image_size(&png), Some((300, 200)));
    }
}
