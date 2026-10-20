//! Seating PINs: staff open a table and read its 6-digit code to the guests,
//! who need it to order from that table's digital menu. Closing the table
//! (by hand, or when its last order is paid, cancelled or removed) ends it.

use super::pos::common::{tx_exec, tx_row, Row};
use crate::{
    activity,
    auth::{constant_time_eq, AuthUser},
    db::RowExt,
    error::{AppError, AppResult},
    input::Input,
    settings::Settings,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use chrono::{Duration, NaiveDateTime};
use rand::Rng;
use serde_json::{json, Value};
use sqlx::MySqlConnection;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/pos/tables/{id}/seat", post(seat))
        .route("/pos/tables/{id}/pin/regenerate", post(regenerate))
        .route("/pos/tables/{id}/close", post(close))
        .route("/pos/tables/{id}/pin", get(show))
}

const PERMISSIONS: [&str; 2] = ["pos_portal", "manage_service_tables"];
/// Wrong codes in a row before the table locks
pub const MAX_FAILURES: i64 = 5;
/// How long a locked table refuses codes
pub const LOCK_MINUTES: i64 = 10;

/* ----------------------------------------------------------------- the PIN */

/// Codes guests could guess first.
pub fn is_weak(pin: &str) -> bool {
    let b = pin.as_bytes();
    pin == "123456" || b.iter().all(|c| *c == b[0])
}

/// A random 6-digit code, never one of the weak ones.
pub fn generate_pin() -> String {
    loop {
        let pin = format!("{:06}", rand::rng().random_range(0..1_000_000u32));
        if !is_weak(&pin) {
            return pin;
        }
    }
}

/// What a table's row says about its seating.
#[derive(Debug, Clone, Default)]
pub struct Seat {
    pub pin: Option<String>,
    pub started_at: Option<NaiveDateTime>,
    pub failed: i64,
    pub locked_until: Option<NaiveDateTime>,
}

impl Seat {
    pub fn from_row(r: &Row) -> Self {
        let time = |k: &str| r.opt_str(k).and_then(|s| crate::datefmt::parse(&s));
        Self {
            pin: r.opt_str("seating_pin").filter(|p| !p.is_empty()),
            started_at: time("seating_started_at"),
            failed: r.i64("pin_failed_attempts"),
            locked_until: time("pin_locked_until"),
        }
    }

    /// Open: a PIN was handed out less than `max_hours` ago.
    pub fn is_open(&self, now: NaiveDateTime, max_hours: i64) -> bool {
        match (&self.pin, self.started_at) {
            (Some(_), Some(at)) => now < at + Duration::hours(max_hours),
            _ => false,
        }
    }

    pub fn is_locked(&self, now: NaiveDateTime) -> bool {
        self.locked_until.is_some_and(|t| now < t)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PinCheck {
    Ok,
    /// No PIN, or it is older than the allowed hours
    NotOpen,
    Locked,
    Missing,
    Wrong,
}

impl PinCheck {
    pub fn error(self) -> AppError {
        match self {
            PinCheck::NotOpen => AppError::field("pin", tr!("This table is not open for ordering. Please ask a member of staff.")),
            PinCheck::Locked => AppError::too_many(tr!("Too many incorrect table codes. Please ask a member of staff.")),
            PinCheck::Missing => AppError::field("pin", tr!("The table code field is required.")),
            PinCheck::Wrong | PinCheck::Ok => AppError::field("pin", tr!("The table code is incorrect.")),
        }
    }
}

/// Compare a guest's code with the table's (state only, no side effects).
pub fn judge(seat: &Seat, given: Option<&str>, now: NaiveDateTime, max_hours: i64) -> PinCheck {
    if !seat.is_open(now, max_hours) {
        return PinCheck::NotOpen;
    }
    if seat.is_locked(now) {
        return PinCheck::Locked;
    }
    let given = given.map(str::trim).unwrap_or_default();
    if given.is_empty() {
        return PinCheck::Missing;
    }
    let pin = seat.pin.as_deref().unwrap_or_default();
    if constant_time_eq(given.as_bytes(), pin.as_bytes()) {
        PinCheck::Ok
    } else {
        PinCheck::Wrong
    }
}

/// Failure counter after one more wrong code, and the lock end when this
/// one reached the limit (the counter then starts again).
pub fn after_failure(failed: i64, now: NaiveDateTime) -> (i64, Option<NaiveDateTime>) {
    let failed = failed.max(0) + 1;
    if failed >= MAX_FAILURES {
        (0, Some(now + Duration::minutes(LOCK_MINUTES)))
    } else {
        (failed, None)
    }
}

/// Check a guest's code inside the order's transaction, locking the table
/// row. Counts wrong codes; the caller commits before returning the error
/// so the count is kept.
pub async fn check_pin(conn: &mut MySqlConnection, s: &Settings, table_id: i64, given: Option<&str>) -> AppResult<PinCheck> {
    let now = s.now();
    let Some(row) = tx_row(conn, "SELECT * FROM service_tables WHERE id = ? FOR UPDATE", vec![table_id.into()]).await? else {
        return Ok(PinCheck::NotOpen);
    };
    let seat = Seat::from_row(&row);
    let check = judge(&seat, given, now, s.seating_pin_max_hours());
    match check {
        PinCheck::Wrong => {
            let (failed, locked) = after_failure(seat.failed, now);
            tx_exec(
                conn,
                "UPDATE service_tables SET pin_failed_attempts = ?, pin_locked_until = ? WHERE id = ?",
                vec![failed.into(), locked.into(), table_id.into()],
            )
            .await?;
        }
        PinCheck::Ok if seat.failed != 0 || seat.locked_until.is_some() => {
            tx_exec(conn, "UPDATE service_tables SET pin_failed_attempts = 0, pin_locked_until = NULL WHERE id = ?", vec![table_id.into()])
                .await?;
        }
        _ => {}
    }
    Ok(check)
}

/// Whether the table's row (as read) is open now.
pub fn row_is_open(s: &Settings, row: &Row) -> bool {
    Seat::from_row(row).is_open(s.now(), s.seating_pin_max_hours())
}

/// End the seating: no PIN, no counters.
pub async fn close_table(conn: &mut MySqlConnection, table_id: i64) -> AppResult<()> {
    tx_exec(
        conn,
        "UPDATE service_tables SET seating_pin = NULL, seating_started_at = NULL, pin_failed_attempts = 0, pin_locked_until = NULL WHERE id = ?",
        vec![table_id.into()],
    )
    .await?;
    Ok(())
}

/// Close the sale's table once the sale stops being open (paid, cancelled,
/// removed or moved) and no other unfinished order is left on it. A sale that
/// was already paid or cancelled no longer held the table, so it never closes
/// a table that has since been opened for someone else.
pub async fn close_after(conn: &mut MySqlConnection, sale: &Row) -> AppResult<()> {
    let Some(table) = sale.opt_i64("table_id") else { return Ok(()) };
    if sale.opt_str("completed_at").is_some() || sale.bool("is_cancelled") {
        return Ok(());
    }
    let busy = tx_row(
        conn,
        "SELECT id FROM sales WHERE table_id = ? AND id <> ? AND completed_at IS NULL AND is_cancelled = 0 LIMIT 1",
        vec![table.into(), sale.i64("id").into()],
    )
    .await?;
    if busy.is_none() {
        close_table(conn, table).await?;
    }
    Ok(())
}

/* ----------------------------------------------------------------- staff */

async fn table_row(conn: &mut MySqlConnection, id: &str) -> AppResult<Row> {
    let id: i64 = id.parse().map_err(|_| AppError::not_found())?;
    tx_row(conn, "SELECT * FROM service_tables WHERE id = ? FOR UPDATE", vec![id.into()]).await?.ok_or_else(AppError::not_found)
}

fn seat_json(s: &Settings, pin: &str, started: NaiveDateTime) -> Value {
    json!({ "pin": pin, "started_at": s.iso(&started), "is_open": true })
}

/// Hand out a new PIN; the counters start again.
async fn issue(conn: &mut MySqlConnection, id: i64, now: NaiveDateTime) -> AppResult<String> {
    let pin = generate_pin();
    tx_exec(
        conn,
        "UPDATE service_tables SET seating_pin = ?, seating_started_at = ?, pin_failed_attempts = 0, pin_locked_until = NULL WHERE id = ?",
        vec![pin.clone().into(), now.into(), id.into()],
    )
    .await?;
    Ok(pin)
}

/// Open the table. Asking again returns the same PIN unless `regenerate`.
async fn seat(
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
    input: Input,
) -> AppResult<Json<Value>> {
    user.require(&PERMISSIONS)?;
    let regenerate = crate::util::truthy(&input.val("regenerate"));
    open(state, user, headers, id, regenerate).await
}

async fn regenerate(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(&PERMISSIONS)?;
    open(state, user, headers, id, true).await
}

async fn open(state: AppState, user: AuthUser, headers: HeaderMap, id: String, regenerate: bool) -> AppResult<Json<Value>> {
    let s = state.settings.get().await;
    let now = s.now();
    let mut tx = state.db.begin().await?;
    let row = table_row(&mut tx, &id).await?;
    let seat = Seat::from_row(&row);
    let open = seat.is_open(now, s.seating_pin_max_hours());
    if open && !regenerate {
        tx.commit().await?;
        let (pin, started) = (seat.pin.unwrap_or_default(), seat.started_at.unwrap_or(now));
        return Ok(Json(seat_json(&s, &pin, started)));
    }
    let pin = issue(&mut tx, row.i64("id"), now).await?;
    tx.commit().await?;
    let what = if open { tr!("Table PIN regenerated") } else { tr!("Table opened") };
    activity::log(&state, &user, &headers, &state.t(what).await, Some(&row.str("title"))).await;
    Ok(Json(seat_json(&s, &pin, now)))
}

async fn close(State(state): State<AppState>, user: AuthUser, headers: HeaderMap, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(&PERMISSIONS)?;
    let mut tx = state.db.begin().await?;
    let row = table_row(&mut tx, &id).await?;
    close_table(&mut tx, row.i64("id")).await?;
    tx.commit().await?;
    activity::log(&state, &user, &headers, &state.t("Table closed").await, Some(&row.str("title"))).await;
    Ok(Json(json!({ "message": state.t("Table closed").await, "is_open": false })))
}

async fn show(State(state): State<AppState>, user: AuthUser, Path(id): Path<String>) -> AppResult<Json<Value>> {
    user.require(&PERMISSIONS)?;
    let s = state.settings.get().await;
    let mut conn = state.db.acquire().await?;
    let id: i64 = id.parse().map_err(|_| AppError::not_found())?;
    let row = tx_row(&mut conn, "SELECT * FROM service_tables WHERE id = ?", vec![id.into()]).await?.ok_or_else(AppError::not_found)?;
    let seat = Seat::from_row(&row);
    let now = s.now();
    if !seat.is_open(now, s.seating_pin_max_hours()) {
        return Ok(Json(json!({ "pin": null, "started_at": null, "is_open": false, "locked": false })));
    }
    Ok(Json(json!({
        "pin": seat.pin,
        "started_at": seat.started_at.map(|t| s.iso(&t)),
        "is_open": true,
        "locked": seat.is_locked(now),
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn at(h: u32, m: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(2026, 10, 20).unwrap().and_hms_opt(h, m, 0).unwrap()
    }

    fn open_seat() -> Seat {
        Seat { pin: Some("482915".into()), started_at: Some(at(12, 0)), failed: 0, locked_until: None }
    }

    #[test]
    fn pins_are_six_digits_and_not_weak() {
        for _ in 0..2000 {
            let p = generate_pin();
            assert_eq!(p.len(), 6);
            assert!(p.bytes().all(|c| c.is_ascii_digit()));
            assert!(!is_weak(&p));
        }
        for weak in ["000000", "123456", "111111", "999999"] {
            assert!(is_weak(weak), "{weak}");
        }
        for fine in ["012345", "654321", "100000", "482915"] {
            assert!(!is_weak(fine), "{fine}");
        }
    }

    #[test]
    fn open_only_within_max_hours() {
        let seat = open_seat();
        assert!(seat.is_open(at(12, 0), 8));
        assert!(seat.is_open(at(19, 59), 8));
        assert!(!seat.is_open(at(20, 0), 8));
        assert!(!Seat::default().is_open(at(12, 0), 8));
        // a PIN without a start time is not open either
        assert!(!Seat { started_at: None, ..open_seat() }.is_open(at(12, 0), 8));
    }

    #[test]
    fn judging_codes() {
        let seat = open_seat();
        let now = at(13, 0);
        assert_eq!(judge(&seat, Some("482915"), now, 8), PinCheck::Ok);
        assert_eq!(judge(&seat, Some(" 482915 "), now, 8), PinCheck::Ok);
        assert_eq!(judge(&seat, Some("482914"), now, 8), PinCheck::Wrong);
        assert_eq!(judge(&seat, Some("4829150"), now, 8), PinCheck::Wrong);
        assert_eq!(judge(&seat, None, now, 8), PinCheck::Missing);
        assert_eq!(judge(&seat, Some(""), now, 8), PinCheck::Missing);
        assert_eq!(judge(&Seat::default(), Some("482915"), now, 8), PinCheck::NotOpen);
        // expired: the old PIN no longer works
        assert_eq!(judge(&seat, Some("482915"), at(21, 0), 8), PinCheck::NotOpen);
        // locked: even the right code is refused until the lock ends
        let locked = Seat { locked_until: Some(at(13, 10)), ..open_seat() };
        assert_eq!(judge(&locked, Some("482915"), at(13, 5), 8), PinCheck::Locked);
        assert_eq!(judge(&locked, Some("482915"), at(13, 10), 8), PinCheck::Ok);
    }

    #[test]
    fn guests_never_see_the_pin() {
        let row: Row = serde_json::from_value(json!({
            "id": 3, "title": "T3", "is_booked": 1,
            "seating_pin": "482915", "seating_started_at": "2026-10-20 12:00:00",
            "pin_failed_attempts": 2, "pin_locked_until": "2026-10-20 12:10:00",
            "created_at": null, "updated_at": null,
        }))
        .unwrap();
        let v = crate::api::pos::common::listed_table(&row, true);
        let keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(keys.len(), 4, "{keys:?}");
        for k in ["id", "title", "is_booked", "is_open"] {
            assert!(keys.contains(&k), "{k} missing");
        }
        let text = v.to_string();
        for secret in ["seating_pin", "pin_failed_attempts", "pin_locked_until", "482915"] {
            assert!(!text.contains(secret), "{secret} leaked: {text}");
        }
        assert_eq!(v["is_open"], json!(true));
    }

    #[test]
    fn fifth_failure_locks_for_ten_minutes() {
        let now = at(13, 0);
        let mut failed = 0;
        for n in 1..MAX_FAILURES {
            let (f, lock) = after_failure(failed, now);
            assert_eq!((f, lock), (n, None));
            failed = f;
        }
        let (f, lock) = after_failure(failed, now);
        assert_eq!(f, 0);
        assert_eq!(lock, Some(at(13, 10)));
    }
}
