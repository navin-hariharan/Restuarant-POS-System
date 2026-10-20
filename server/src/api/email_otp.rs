//! E-mail codes for the digital menu: a guest asks for a 6-digit code, types
//! it back and gets a token that lets them order from that table with that
//! address until it expires or the table is closed. Only salted hashes of the
//! codes and hashes of the tokens are stored; neither is ever logged.

use super::{
    auth::{render_mail, Mail},
    digital_menu::valid_email,
    pos::common::{fk_id, tx_exec, tx_row},
    seating::{self, PinCheck},
};
use crate::{
    activity::client_ip,
    auth::{constant_time_eq, sha256_hex},
    db::RowExt,
    error::{AppError, AppResult},
    input::Input,
    settings::Settings,
    state::AppState,
};
use axum::{extract::State, http::HeaderMap, routing::post, Json, Router};
use chrono::{Duration, NaiveDateTime};
use rand::Rng;
use serde_json::{json, Value};
use sqlx::MySqlConnection;

pub fn router() -> Router<AppState> {
    Router::new().route("/digital-menu/email-otp/send", post(send)).route("/digital-menu/email-otp/verify", post(verify))
}

/// Minutes a code can be typed in
const CODE_MINUTES: i64 = 10;
/// Wrong tries before a code is burned
pub const MAX_ATTEMPTS: i64 = 5;
/// Longest a verified address stays verified
const TOKEN_HOURS: i64 = 4;

/// Sending limits, counted from the stored rows.
const COOLDOWN_SECONDS: i64 = 60;
const PER_EMAIL_HOUR: i64 = 5;
const PER_IP_HOUR: i64 = 10;
const PER_TABLE_HOUR: i64 = 30;

/* ------------------------------------------------------------------ pieces */

/// Trimmed, lower-case address, or None when it is not a valid one.
pub fn normalize_email(raw: &str) -> Option<String> {
    let e = raw.trim().to_lowercase();
    (!e.is_empty() && e.len() <= 191 && valid_email(&e)).then_some(e)
}

pub fn new_code() -> String {
    format!("{:06}", rand::rng().random_range(0..1_000_000u32))
}

pub fn new_salt() -> String {
    hex::encode(rand::rng().random::<[u8; 8]>())
}

pub fn new_token() -> String {
    hex::encode(rand::rng().random::<[u8; 32]>())
}

pub fn code_hash(salt: &str, code: &str) -> String {
    sha256_hex(&format!("{salt}:{code}"))
}

/// What a stored code row allows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CodeCheck {
    Ok,
    Wrong {
        burned: bool,
    },
    /// expired, used or out of tries
    Unusable,
}

/// Compare a typed code with a stored row (state only, no side effects).
pub fn judge_code(salt: &str, hash: &str, attempts: i64, expires_at: Option<NaiveDateTime>, typed: &str, now: NaiveDateTime) -> CodeCheck {
    if attempts >= MAX_ATTEMPTS || expires_at.is_none_or(|t| now >= t) {
        return CodeCheck::Unusable;
    }
    if constant_time_eq(code_hash(salt, typed.trim()).as_bytes(), hash.as_bytes()) {
        CodeCheck::Ok
    } else {
        CodeCheck::Wrong { burned: attempts + 1 >= MAX_ATTEMPTS }
    }
}

/// How long a verification token lasts: the seating limit, at most four hours.
pub fn token_hours(max_hours: i64) -> i64 {
    max_hours.clamp(1, TOKEN_HOURS)
}

/// Forget every code and token of a table (it was closed or opened again).
pub async fn forget_table(conn: &mut MySqlConnection, table_id: i64) -> AppResult<()> {
    tx_exec(conn, "DELETE FROM digital_menu_email_otps WHERE table_id = ?", vec![table_id.into()]).await?;
    Ok(())
}

/// The order's e-mail was verified for this table with this token.
pub async fn token_valid(conn: &mut MySqlConnection, table_id: i64, email: &str, token: &str, now: NaiveDateTime) -> AppResult<bool> {
    if token.len() != 64 {
        return Ok(false);
    }
    let row = tx_row(
        conn,
        "SELECT id FROM digital_menu_email_otps WHERE token_hash = ? AND email = ? AND table_id = ? AND verified_at IS NOT NULL AND token_expires_at > ? LIMIT 1",
        vec![sha256_hex(token).into(), email.into(), table_id.into(), now.into()],
    )
    .await?;
    Ok(row.is_some())
}

fn guard(s: &Settings) -> AppResult<()> {
    let modes = s.modes();
    if !modes.digital_menu {
        return Err(AppError::forbidden("Digital menu is disabled"));
    }
    if !modes.digital_menu_verify_email {
        return Err(AppError::forbidden(tr!("Email verification is not turned on.")));
    }
    Ok(())
}

fn table_of(input: &Input) -> AppResult<i64> {
    input.get("table_id").and_then(fk_id).ok_or_else(|| AppError::field("table_id", "No table was found"))
}

fn email_of(input: &Input) -> AppResult<String> {
    match input.opt_str("email") {
        None => Err(AppError::field("email", "The email field is required.")),
        Some(e) => normalize_email(&e).ok_or_else(|| AppError::field("email", "The email must be a valid email address.")),
    }
}

async fn count(conn: &mut MySqlConnection, filter: &str, arg: String, since: NaiveDateTime) -> AppResult<i64> {
    let row = tx_row(
        conn,
        &format!("SELECT COUNT(*) AS n FROM digital_menu_email_otps WHERE {filter} = ? AND created_at > ?"),
        vec![arg.into(), since.into()],
    )
    .await?;
    Ok(row.map(|r| r.i64("n")).unwrap_or(0))
}

/* -------------------------------------------------------------- endpoints */

async fn send(State(state): State<AppState>, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    let s = state.settings.get().await;
    guard(&s)?;
    let table = table_of(&input)?;
    let now = s.now();
    let ip = client_ip(&headers);

    let mut tx = state.db.begin().await?;
    // The table code first, so codes are only mailed to guests at an open table.
    if s.modes().digital_menu_pin {
        if !state.limiter.allow(&format!("pin:{ip}"), 20) {
            return Err(AppError::too_many(tr!("Too many attempts. Please wait a minute and try again.")));
        }
        let check = seating::check_pin(&mut tx, &s, table, input.opt_str("pin").as_deref()).await?;
        if check != PinCheck::Ok {
            tx.commit().await?;
            return Err(check.error());
        }
    } else if tx_row(&mut tx, "SELECT id FROM service_tables WHERE id = ?", vec![table.into()]).await?.is_none() {
        return Err(AppError::field("table_id", "No table was found"));
    }
    let email = email_of(&input)?;

    tx_exec(&mut tx, "DELETE FROM digital_menu_email_otps WHERE created_at < ?", vec![(now - Duration::days(1)).into()]).await?;
    let hour = now - Duration::hours(1);
    let recent = tx_row(
        &mut tx,
        "SELECT id FROM digital_menu_email_otps WHERE email = ? AND table_id = ? AND created_at > ? LIMIT 1",
        vec![email.clone().into(), table.into(), (now - Duration::seconds(COOLDOWN_SECONDS)).into()],
    )
    .await?;
    let busy = recent.is_some()
        || count(&mut tx, "email", email.clone(), hour).await? >= PER_EMAIL_HOUR
        || count(&mut tx, "ip", ip.clone(), hour).await? >= PER_IP_HOUR
        || count(&mut tx, "table_id", table.to_string(), hour).await? >= PER_TABLE_HOUR;
    if busy {
        tx.commit().await?;
        return Err(AppError::too_many(tr!("Too many code requests. Please wait a little and try again.")));
    }

    let code = new_code();
    let salt = new_salt();
    let id = tx_exec(
        &mut tx,
        "INSERT INTO digital_menu_email_otps (email, table_id, code_hash, salt, attempts, ip, expires_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)",
        vec![
            email.clone().into(),
            table.into(),
            code_hash(&salt, &code).into(),
            salt.into(),
            ip.chars().take(191).collect::<String>().into(),
            (now + Duration::minutes(CODE_MINUTES)).into(),
            now.into(),
        ],
    )
    .await?
    .last_insert_id();
    tx.commit().await?;

    let sent = if s.mail_ready() {
        let app = s.str("app_name");
        let subject = state.tp("Your verification code for :app", &[("app", &app)]).await;
        let mins = CODE_MINUTES.to_string();
        let html = render_mail(
            &state,
            &s,
            Mail {
                greeting: state.t("Hello!").await,
                intro: vec![state.t("Use this code to confirm your email address and place your order:").await, code],
                action: None,
                outro: vec![
                    state.tp("The code expires in :count minutes.", &[("count", &mins)]).await,
                    state.t("If you did not ask for this code, you can ignore this email.").await,
                ],
            },
        )
        .await;
        crate::notify::send_mail(&state, &email, &subject, &html).await
    } else {
        Err(anyhow::anyhow!("outgoing mail is not set up"))
    };
    if let Err(e) = sent {
        tracing::warn!(error = %e, table = table, "could not send a digital menu e-mail code");
        let _ = sqlx::query("DELETE FROM digital_menu_email_otps WHERE id = ?").bind(id).execute(&state.db).await;
        return Err(AppError::field("email", tr!("We could not send the code. Please ask a member of staff.")));
    }
    Ok(Json(json!({ "message": state.t("If the address can receive email, a code is on its way.").await })))
}

async fn verify(State(state): State<AppState>, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    let s = state.settings.get().await;
    guard(&s)?;
    if !state.limiter.allow(&format!("otp_verify:{}", client_ip(&headers)), 20) {
        return Err(AppError::too_many(tr!("Too many attempts. Please wait a minute and try again.")));
    }
    let table = table_of(&input)?;
    let email = email_of(&input)?;
    let typed = input.opt_str("code").unwrap_or_default();
    if typed.trim().is_empty() {
        return Err(AppError::field("otp", tr!("The code field is required.")));
    }
    let now = s.now();
    let mut tx = state.db.begin().await?;
    let row = tx_row(
        &mut tx,
        "SELECT * FROM digital_menu_email_otps WHERE email = ? AND table_id = ? AND verified_at IS NULL AND attempts < ? AND expires_at > ? ORDER BY id DESC LIMIT 1 FOR UPDATE",
        vec![email.clone().into(), table.into(), MAX_ATTEMPTS.into(), now.into()],
    )
    .await?;
    let Some(row) = row else {
        return Err(AppError::field("otp", tr!("This code has expired. Please ask for a new one.")));
    };
    let expires = row.opt_str("expires_at").and_then(|t| crate::datefmt::parse(&t));
    match judge_code(&row.str("salt"), &row.str("code_hash"), row.i64("attempts"), expires, &typed, now) {
        CodeCheck::Ok => {
            let token = new_token();
            let until = now + Duration::hours(token_hours(s.seating_pin_max_hours()));
            tx_exec(
                &mut tx,
                "UPDATE digital_menu_email_otps SET verified_at = ?, token_hash = ?, token_expires_at = ? WHERE id = ?",
                vec![now.into(), sha256_hex(&token).into(), until.into(), row.i64("id").into()],
            )
            .await?;
            tx.commit().await?;
            Ok(Json(json!({ "verification_token": token, "expires_at": s.iso(&until) })))
        }
        CodeCheck::Wrong { burned } => {
            tx_exec(&mut tx, "UPDATE digital_menu_email_otps SET attempts = attempts + 1 WHERE id = ?", vec![row.i64("id").into()]).await?;
            tx.commit().await?;
            Err(AppError::field(
                "otp",
                if burned { tr!("Too many wrong codes. Please ask for a new one.") } else { tr!("The code is incorrect.") },
            ))
        }
        CodeCheck::Unusable => Err(AppError::field("otp", tr!("This code has expired. Please ask for a new one."))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn at(h: u32, m: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(2026, 10, 20).unwrap().and_hms_opt(h, m, 0).unwrap()
    }

    #[test]
    fn emails_are_normalized() {
        assert_eq!(normalize_email("  Asha.R@Example.COM ").as_deref(), Some("asha.r@example.com"));
        assert_eq!(normalize_email("guest@example.com").as_deref(), Some("guest@example.com"));
        for bad in ["", "   ", "no-at-sign", "a@", "@b.c", "a b@c.d", "a@.c", "a@c."] {
            assert_eq!(normalize_email(bad), None, "{bad}");
        }
        let long = format!("{}@example.com", "a".repeat(180));
        assert_eq!(normalize_email(&long), None);
    }

    #[test]
    fn codes_salts_and_tokens() {
        for _ in 0..500 {
            let c = new_code();
            assert!(c.len() == 6 && c.bytes().all(|b| b.is_ascii_digit()));
        }
        assert_eq!(new_salt().len(), 16);
        let t = new_token();
        assert_eq!(t.len(), 64);
        assert_ne!(t, new_token());
        // salted: the same code hashes differently with another salt
        assert_ne!(code_hash("aaaaaaaaaaaaaaaa", "123456"), code_hash("bbbbbbbbbbbbbbbb", "123456"));
        assert_eq!(code_hash("aaaaaaaaaaaaaaaa", "123456").len(), 64);
    }

    #[test]
    fn checking_codes() {
        let salt = "0123456789abcdef";
        let hash = code_hash(salt, "482915");
        let exp = Some(at(12, 10));
        assert_eq!(judge_code(salt, &hash, 0, exp, "482915", at(12, 0)), CodeCheck::Ok);
        assert_eq!(judge_code(salt, &hash, 0, exp, " 482915 ", at(12, 0)), CodeCheck::Ok);
        assert_eq!(judge_code(salt, &hash, 0, exp, "482916", at(12, 0)), CodeCheck::Wrong { burned: false });
        // the fifth wrong try burns the code
        assert_eq!(judge_code(salt, &hash, 4, exp, "482916", at(12, 0)), CodeCheck::Wrong { burned: true });
        // out of tries: even the right code is refused
        assert_eq!(judge_code(salt, &hash, 5, exp, "482915", at(12, 0)), CodeCheck::Unusable);
        // expired
        assert_eq!(judge_code(salt, &hash, 0, exp, "482915", at(12, 10)), CodeCheck::Unusable);
        assert_eq!(judge_code(salt, &hash, 0, None, "482915", at(12, 0)), CodeCheck::Unusable);
    }

    #[test]
    fn tokens_last_at_most_four_hours() {
        assert_eq!(token_hours(8), 4);
        assert_eq!(token_hours(2), 2);
        assert_eq!(token_hours(0), 1);
    }
}
