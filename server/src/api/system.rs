//! GET /app-config: the public configuration the web app loads before
//! anything else (name, branding, formats, taxes, printer and modes).

use crate::{settings::Settings, state::AppState};
use axum::{
    extract::State,
    http::{header, HeaderMap},
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};

pub fn router() -> Router<AppState> {
    Router::new().route("/app-config", get(app_config))
}

/// Date formats offered in Settings > Localization (PHP date() syntax).
const DATE_FORMATS: [&str; 16] = [
    "d-m-Y",
    "Y-m-d",
    "d-m-Y h:s:i",
    "d-m-Y, h:s:i",
    "Y-m-d h:s:i",
    "Y-m-d, h:s:i",
    "d D M Y",
    "Y M D d",
    "d D M Y, h:s:i",
    "d D M Y h:s:i",
    "Y M D d, h:s:i",
    "Y M D d h:s:i",
    "Y-m-d H:i:s",
    "d-m-Y H:i:s",
    "Y/m/d H:i:s",
    "d/m/Y H:i:s",
];

/// Site address: the configured APP_URL, else the address the browser used.
fn site_url(state: &AppState, headers: &HeaderMap) -> String {
    if !state.cfg.app_url.is_empty() {
        return state.cfg.app_url.clone();
    }
    let host = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get(header::HOST))
        .and_then(|v| v.to_str().ok())
        .map(|h| h.split(',').next().unwrap_or("").trim().to_string())
        .filter(|h| !h.is_empty() && h.chars().all(|c| c.is_ascii_alphanumeric() || ".-:[]".contains(c)));
    let proto = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .map(|p| p.split(',').next().unwrap_or("").trim().to_ascii_lowercase())
        .filter(|p| p == "https" || p == "http")
        .unwrap_or_else(|| "http".into());
    host.map(|h| format!("{proto}://{h}")).unwrap_or_default()
}

/// Uploaded image URL, or the default image shipped with the web app.
fn image(state: &AppState, s: &Settings, col: &str, default: &str) -> String {
    match s.opt_str(col) {
        Some(p) => state.storage_url(&p),
        None => state.asset_url(default),
    }
}

/// A `double` column as PHP prints it (12 not 12.0).
fn number(v: &Value) -> Value {
    match v {
        Value::Null => Value::Null,
        other => crate::util::json_num(crate::util::num(other)),
    }
}

async fn app_config(State(state): State<AppState>, headers: HeaderMap) -> Json<Value> {
    let s = state.settings.get().await;
    let m = s.modes();
    let mut order_types = vec![
        json!({ "title": state.t("Dining").await, "key": "dining" }),
        json!({ "title": state.t("Pickup").await, "key": "pickup" }),
        json!({ "title": state.t("Delivery").await, "key": "dilivery" }),
    ];
    if m.room_reservations {
        order_types.push(json!({ "title": state.t("Room Service").await, "key": "roomservice" }));
    }
    let tax_setup = json!({
            "tax_title": s.val("tax_title"),
            "rate": number(&s.val("tax_rate")),
            "tax_rate": number(&s.val("tax_rate")),
            "is_tax_fix": s.flag("is_tax_fix"),
            "is_tax_included": s.flag("is_tax_included"),
            "tax_id": s.val("tax_id"),
            "is_vat": s.flag("is_vat"),
        });
    let printer = json!({
            "print_font_family": s.val("print_font_family"),
            "print_name_address_position": s.val("print_name_address_position"),
            "print_name_address_size": s.val("print_name_address_size"),
            "print_header_footer_size": s.val("print_header_footer_size"),
            "print_items_font_size": s.val("print_items_font_size"),
            "print_terms_conditions_font_size": s.val("print_terms_conditions_font_size"),
            "print_font_color": s.val("print_font_color"),
            "printer_width": s.val("printer_width"),
            "printer_height": s.val("printer_height"),
            "signature_required": s.flag("signature_required"),
            "terms_conditions": s.val("terms_conditions"),
            "print_auto": s.flag("print_auto"),
            "invoice_type": s.val("invoice_type_title"),
            "display_logo": s.flag("display_logo"),
        });
    let modes = json!({
            "cashbooks": m.cashbooks,
            "print_on_submit": m.print_on_submit,
            "customer_tip_collection": m.customer_tip_collection,
            "bypass_kitchen_bar": m.bypass_kitchen_bar,
            "allow_table_reselect": m.allow_table_reselect,
            "table_is_option": m.table_is_option,
            "allow_to_edit_checked_orders": m.allow_to_edit_checked_orders,
            "disable_room_reservations": m.room_reservations,
            "elengent_search": m.elegant_search,
            "item_based_tax": m.item_based_tax,
            "item_consumption_mode": m.item_consumption,
            "autoclose_service_table_model": m.autoclose_service_table_model,
            "autoclose_pickup_model": m.autoclose_pickup_model,
            "autoclose_customer_model": m.autoclose_customer_model,
            "autoclose_shipping_model": m.autoclose_shipping_model,
            "taxation": m.taxation,
            "digital_menu": m.digital_menu,
            "allow_expiry_date": m.allow_expiry_date,
            "room_reservations_enabled": m.room_reservations,
        });
    Json(json!({
        "url": site_url(&state, &headers),
        "name": s.val("app_name"),
        "phone": s.val("app_phone"),
        "address": s.val("app_address"),
        "portal_about": null,
        "register": s.flag("app_user_registration"),
        "icon": image(&state, &s, "app_icon", "images/default/icon.png"),
        "background": image(&state, &s, "app_background", "images/default/background.png"),
        "recaptcha_enabled": s.flag("recaptcha_enabled"),
        "recaptcha_public": s.val("recaptcha_public"),
        "meta_home_title": null,
        "app_date_format": s.val("app_date_format"),
        "app_date_locale": s.val("app_date_locale"),
        "app_timezone": s.val("app_timezone"),
        "currency_symbol": s.val("currency_symbol"),
        "currency_symbol_on_left": s.flag("currency_symbol_on_left"),
        "tax_setup": tax_setup,
        "synchronizer_dispay": true,
        "is_demo_mode": state.cfg.demo_mode,
        "version": env!("CARGO_PKG_VERSION"),
        "printer": printer,
        "time_date_formats": DATE_FORMATS,
        "order_types": order_types,
        "app_direction": if s.opt_str("app_direction").as_deref() == Some("rtl") { "rtl" } else { "ltr" },
        "tax_id": s.val("vat_number"),
        "locale": s.opt_str("app_locale").unwrap_or_else(|| "en".into()),
        "modes": modes,
    }))
}
