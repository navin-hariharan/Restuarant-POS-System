//! The `settings` row (id 1): everything an admin changes from the Settings
//! screens, including the feature modes. Cached in memory and reloaded after
//! every change, so reads are free.

use crate::{
    db::{row_json, Db, RowExt},
    error::AppResult,
};
use chrono::{NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use serde_json::{Map, Value};
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone, Default)]
pub struct SettingsStore {
    inner: Arc<RwLock<Arc<Settings>>>,
}

#[derive(Debug, Clone, Default)]
pub struct Settings {
    pub row: Map<String, Value>,
}

impl SettingsStore {
    pub async fn get(&self) -> Arc<Settings> {
        self.inner.read().await.clone()
    }

    /// Reload from the database (call after any update to `settings`).
    pub async fn reload(&self, db: &Db) -> AppResult<Arc<Settings>> {
        let row = sqlx::query("SELECT * FROM settings WHERE id = 1").fetch_optional(db).await?;
        let s = Arc::new(Settings { row: row.as_ref().map(row_json).unwrap_or_default() });
        *self.inner.write().await = s.clone();
        Ok(s)
    }
}

impl Settings {
    pub fn str(&self, key: &str) -> String {
        self.row.str(key)
    }
    pub fn opt_str(&self, key: &str) -> Option<String> {
        self.row.opt_str(key).filter(|s| !s.is_empty())
    }
    pub fn flag(&self, key: &str) -> bool {
        self.row.bool(key)
    }
    pub fn val(&self, key: &str) -> Value {
        self.row.val(key)
    }

    /// PHP date() format for displayed dates (Settings > Localization)
    pub fn date_format(&self) -> String {
        self.opt_str("app_date_format").unwrap_or_else(|| "d-m-Y".into())
    }

    pub fn tz(&self) -> Tz {
        self.opt_str("app_timezone").and_then(|t| t.parse().ok()).unwrap_or(chrono_tz::UTC)
    }

    /// Current wall-clock time in the restaurant's time zone, as stored in the
    /// database (naive, like every timestamp column).
    pub fn now(&self) -> NaiveDateTime {
        Utc::now().with_timezone(&self.tz()).naive_local().with_nanosecond_zero()
    }

    /// A stored timestamp formatted with the configured date format.
    pub fn fmt_date(&self, dt: &NaiveDateTime) -> String {
        crate::datefmt::php_format(dt, &self.date_format())
    }

    /// Same, from a "Y-m-d H:i:s" JSON value (null stays null).
    pub fn fmt_value(&self, v: &Value) -> Value {
        match v.as_str().and_then(crate::datefmt::parse) {
            Some(dt) => Value::from(self.fmt_date(&dt)),
            None => Value::Null,
        }
    }

    /// ISO 8601 in UTC ("2024-10-23T00:13:38.000000Z"), for whole records.
    pub fn iso(&self, dt: &NaiveDateTime) -> String {
        let utc = self.tz().from_local_datetime(dt).earliest().map(|d| d.naive_utc()).unwrap_or(*dt);
        crate::datefmt::iso(&utc)
    }

    pub fn iso_value(&self, v: &Value) -> Value {
        match v.as_str().and_then(crate::datefmt::parse) {
            Some(dt) => Value::from(self.iso(&dt)),
            None => Value::Null,
        }
    }

    pub fn currency(&self) -> String {
        self.str("currency_symbol")
    }

    pub fn modes(&self) -> Modes {
        Modes {
            cashbooks: self.flag("advance_cashbook_mode"),
            print_on_submit: self.flag("advance_print_on_submit"),
            customer_tip_collection: self.flag("advance_customer_tip_collection"),
            bypass_kitchen_bar: self.flag("bypass_kitchen_bar"),
            allow_table_reselect: self.flag("allow_table_reselect"),
            table_is_option: self.flag("table_is_option"),
            allow_to_edit_checked_orders: self.flag("allow_to_edit_checked_orders"),
            // historical column name: true ENABLES room reservations
            room_reservations: self.flag("disable_room_reservations"),
            elegant_search: self.flag("elengent_search"),
            item_based_tax: self.flag("item_based_tax"),
            item_consumption: self.flag("item_consumption_mode"),
            autoclose_service_table_model: self.flag("autoclose_service_table_model"),
            autoclose_pickup_model: self.flag("autoclose_pickup_model"),
            autoclose_customer_model: self.flag("autoclose_customer_model"),
            autoclose_shipping_model: self.flag("autoclose_shipping_model"),
            taxation: self.flag("taxation"),
            digital_menu: self.flag("digital_menu"),
            digital_menu_pin: self.flag("digital_menu_require_pin"),
            // paused while outgoing mail can not deliver the code
            digital_menu_verify_email: self.flag("digital_menu_verify_email") && self.mail_ready(),
            allow_expiry_date: self.flag("allow_expiry_date"),
            send_notification: self.flag("advance_send_notification"),
            wa_status: self.flag("wa_status"),
            sms_status: self.flag("sms_status"),
            display_logo: self.flag("display_logo"),
        }
    }

    /// Outgoing mail can reach a guest: a sender is set and the mailer is
    /// not the log (which would only write the message to the server log).
    pub fn mail_ready(&self) -> bool {
        self.opt_str("mail_from_address").is_some()
            && matches!(self.opt_str("mail_mailer").as_deref(), Some("smtp" | "sendmail" | "mailgun"))
    }

    /// Hours a seating PIN stays valid after the table was opened.
    pub fn seating_pin_max_hours(&self) -> i64 {
        match self.row.i64("seating_pin_max_hours") {
            h if h > 0 => h,
            _ => 8,
        }
    }

    /// LIKE pattern for searches ("starts with" when elegant search is on)
    pub fn search_pattern(&self, term: &str) -> String {
        crate::db::like_pattern(term, self.modes().elegant_search)
    }
}

trait ZeroNanos {
    fn with_nanosecond_zero(self) -> Self;
}
impl ZeroNanos for NaiveDateTime {
    fn with_nanosecond_zero(self) -> Self {
        use chrono::Timelike;
        self.with_nanosecond(0).unwrap_or(self)
    }
}

#[derive(Debug, Clone, Copy, Default, serde::Serialize)]
pub struct Modes {
    pub cashbooks: bool,
    pub print_on_submit: bool,
    pub customer_tip_collection: bool,
    pub bypass_kitchen_bar: bool,
    pub allow_table_reselect: bool,
    pub table_is_option: bool,
    pub allow_to_edit_checked_orders: bool,
    pub room_reservations: bool,
    pub elegant_search: bool,
    pub item_based_tax: bool,
    pub item_consumption: bool,
    pub autoclose_service_table_model: bool,
    pub autoclose_pickup_model: bool,
    pub autoclose_customer_model: bool,
    pub autoclose_shipping_model: bool,
    pub taxation: bool,
    pub digital_menu: bool,
    /// Digital menu orders need the table's seating PIN.
    pub digital_menu_pin: bool,
    /// Digital menu orders need an e-mail address confirmed with a code.
    pub digital_menu_verify_email: bool,
    pub allow_expiry_date: bool,
    pub send_notification: bool,
    pub wa_status: bool,
    pub sms_status: bool,
    pub display_logo: bool,
}
