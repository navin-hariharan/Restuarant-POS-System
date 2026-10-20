//! Sign-in, sign-out, registration and password recovery.

use crate::{
    api::{
        account::check_new_password,
        users::{self, rules},
    },
    auth::{sha256_hex, AuthUser},
    db::RowExt,
    error::{AppError, AppResult, Errors},
    input::Input,
    query::Sql,
    settings::Settings,
    state::AppState,
};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};

pub fn router() -> Router<AppState> {
    let demo = || axum::middleware::from_fn(crate::middleware::demo_mode);
    Router::new()
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/auth/register", post(register))
        .route("/auth/recover", post(recover).route_layer(demo()))
        .route("/auth/reset", post(reset).route_layer(demo()))
        .route("/auth/user", get(current_user))
        .route("/auth/check", post(check))
}

/// Minutes a password reset link stays valid.
const RESET_EXPIRE_MINUTES: i64 = 60;

/// A bcrypt hash of a random value, checked when the e-mail is unknown so a
/// failed sign-in takes as long whether or not the account exists.
fn dummy_hash() -> &'static str {
    static HASH: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    HASH.get_or_init(|| crate::auth::hash_password(&crate::util::random_string(32)).unwrap_or_default())
}

fn too_many() -> AppError {
    AppError::Status(StatusCode::TOO_MANY_REQUESTS, tr!("Too many attempts. Please wait a minute and try again.").into())
}

/// Lowercase ASCII slug with `sep` between words (token names).
pub fn slug(s: &str, sep: char) -> String {
    let mut out = String::new();
    let mut pending = false;
    for c in s.replace('@', &format!("{sep}at{sep}")).chars() {
        if c.is_ascii_alphanumeric() {
            if pending && !out.is_empty() {
                out.push(sep);
            }
            pending = false;
            out.push(c.to_ascii_lowercase());
        } else if c.is_whitespace() || c == '-' || c == '_' || c == sep {
            pending = true;
        }
    }
    out
}

async fn token_name(state: &AppState) -> String {
    let s = state.settings.get().await;
    slug(&format!("{}_auth_token", s.str("app_name")), '_')
}

/// reCAPTCHA check (Settings > Captcha) for the sign-in and recovery forms.
async fn verify_captcha(state: &AppState, s: &Settings, input: &Input, headers: &HeaderMap) -> AppResult<()> {
    if !s.flag("recaptcha_enabled") {
        return Ok(());
    }
    let failed = || AppError::bad_request("Unable to verify captcha");
    let Some(response) = input.opt_str("captcha_hash") else { return Err(failed()) };
    let secret = s.str("recaptcha_private");
    let ip = crate::activity::client_ip(headers);
    let mut form = vec![("secret", secret.as_str()), ("response", response.as_str())];
    if ip != "unknown" {
        form.push(("remoteip", ip.as_str()));
    }
    let res = state.http.post("https://www.google.com/recaptcha/api/siteverify").form(&form).send().await;
    let body: Value = match res {
        Ok(r) => r.json().await.unwrap_or(Value::Null),
        Err(e) => {
            tracing::warn!(error = %e, "captcha verification failed");
            return Err(failed());
        }
    };
    let success = body.get("success").and_then(Value::as_bool).unwrap_or(false);
    // v3 answers carry a score; v2 answers only `success`
    let score_ok = body.get("score").map(|v| v.as_f64().unwrap_or(0.0) >= 0.5).unwrap_or(true);
    if success && score_ok {
        Ok(())
    } else {
        Err(failed())
    }
}

/// Address of the web app for links in e-mails: the configured public URL,
/// never the request's Host header (which a client controls).
fn public_url(state: &AppState, s: &Settings) -> Option<String> {
    let cfg = state.cfg.app_url.trim_end_matches('/');
    if !cfg.is_empty() {
        return Some(cfg.to_string());
    }
    s.opt_str("app_url").map(|u| u.trim().trim_end_matches('/').to_string()).filter(|u| u.starts_with("http"))
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

/// PHP urlencode()
fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' => (b as char).to_string(),
            b' ' => "+".into(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

pub(crate) struct Mail<'a> {
    pub greeting: String,
    pub intro: Vec<String>,
    pub action: Option<(String, &'a str)>,
    pub outro: Vec<String>,
}

/// A simple, mail-client friendly HTML message.
pub(crate) async fn render_mail(state: &AppState, s: &Settings, m: Mail<'_>) -> String {
    let app = html_escape(&s.str("app_name"));
    let p = |t: &str| format!("<p style=\"margin:0 0 16px;font-size:15px;line-height:1.5;color:#3d4852\">{}</p>", html_escape(t));
    let mut body = format!("<h1 style=\"margin:0 0 16px;font-size:18px;color:#3d4852\">{}</h1>", html_escape(&m.greeting));
    for l in &m.intro {
        body.push_str(&p(l));
    }
    let mut trouble = String::new();
    if let Some((text, url)) = &m.action {
        body.push_str(&format!(
            "<p style=\"margin:24px 0;text-align:center\"><a href=\"{u}\" style=\"display:inline-block;padding:10px 22px;border-radius:6px;background:#2d3748;color:#ffffff;text-decoration:none;font-size:15px\">{t}</a></p>",
            u = html_escape(url),
            t = html_escape(text)
        ));
        let hint = state
            .tp(
                "If you're having trouble clicking the \":actionText\" button, copy and paste the URL below into your web browser:",
                &[("actionText", text)],
            )
            .await;
        trouble = format!(
            "<p style=\"margin:24px 0 0;font-size:12px;line-height:1.5;color:#718096;border-top:1px solid #e8e5ef;padding-top:16px\">{}<br><a href=\"{u}\" style=\"color:#3869d4;word-break:break-all\">{u}</a></p>",
            html_escape(&hint),
            u = html_escape(url)
        );
    }
    for l in &m.outro {
        body.push_str(&p(l));
    }
    body.push_str(&p(&format!("{}\n{}", state.t("Regards,").await, s.str("app_name"))).replace('\n', "<br>"));
    format!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>{app}</title></head>\
         <body style=\"margin:0;padding:0;background:#edf2f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif\">\
         <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#edf2f7;padding:24px 12px\"><tr><td align=\"center\">\
         <p style=\"margin:0 0 16px;font-size:19px;font-weight:bold;color:#3d4852\">{app}</p>\
         <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:570px;background:#ffffff;border-radius:4px\"><tr><td style=\"padding:32px\">{body}{trouble}</td></tr></table>\
         </td></tr></table></body></html>"
    )
}

/// Send in the background, like a queued notification: the request never
/// waits for, or fails because of, the mail server.
fn send_later(state: &AppState, to: String, subject: String, html: String) {
    let state = state.clone();
    tokio::spawn(async move {
        if let Err(e) = crate::notify::send_mail(&state, &to, &subject, &html).await {
            tracing::warn!(error = %e, "could not send account e-mail");
        }
    });
}

async fn login(State(state): State<AppState>, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    if !crate::middleware::login_allowed(&state, &headers) {
        return Err(too_many());
    }
    let s = state.settings.get().await;
    verify_captcha(&state, &s, &input, &headers).await?;
    let mut e = Errors::default();
    match input.opt_str("email") {
        None => e.add("email", rules::required_msg("email")),
        Some(m) if !rules::is_email(&m) => e.add("email", rules::email_msg("email")),
        _ => {}
    }
    if input.str("password").is_none() {
        e.add("password", rules::required_msg("password"));
    }
    e.check()?;
    let email = input.string("email");
    let password = input.str("password").unwrap_or_default();
    let row = Sql::new("SELECT * FROM users WHERE email = ? LIMIT 1").push_args("", [email]).fetch_optional(&state.db).await?;
    let ok = match &row {
        Some(u) => crate::auth::verify_password(&password, &u.str("password")),
        None => {
            let _ = crate::auth::verify_password(&password, dummy_hash());
            false
        }
    };
    let Some(user) = row.filter(|_| ok) else {
        return Err(AppError::not_acceptable("These credentials do not match, or the user is disabled"));
    };
    if user.i64("status") != 1 {
        return Err(AppError::not_acceptable("The user is deactivated"));
    }
    let token = crate::auth::create_token(&state, user.i64("id"), &token_name(&state).await).await?;
    Ok(Json(json!({ "token": token, "user": users::user_resource(&state, &user).await? })))
}

async fn logout(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    sqlx::query("DELETE FROM personal_access_tokens WHERE tokenable_type = ? AND tokenable_id = ?")
        .bind(crate::auth::TOKENABLE_USER)
        .bind(user.id)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "message": state.t("Session closed successfully").await })))
}

async fn register(State(state): State<AppState>, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    let s = state.settings.get().await;
    if !s.flag("app_user_registration") {
        return Err(AppError::forbidden("Forbidden"));
    }
    if !crate::middleware::login_allowed(&state, &headers) {
        return Err(too_many());
    }
    verify_captcha(&state, &s, &input, &headers).await?;
    let mut e = Errors::default();
    let name = input.opt_str("name");
    match &name {
        None => e.add("name", rules::required_msg("name")),
        Some(n) if rules::len(n) > 255 => e.add("name", rules::max_msg("name", 255)),
        _ => {}
    }
    let email = input.opt_str("email");
    match &email {
        None => e.add("email", rules::required_msg("email")),
        Some(m) => {
            if !rules::is_email(m) {
                e.add("email", rules::email_msg("email"));
            }
            if rules::len(m) > 255 {
                e.add("email", rules::max_msg("email", 255));
            }
            if !e.has("email") && rules::taken(&state.db, "users", "email", m, None).await? {
                e.add("email", rules::taken_msg("email"));
            }
        }
    }
    let password = check_new_password(&input, &mut e);
    e.check()?;
    let (name, email, password) = (name.unwrap_or_default(), email.unwrap_or_default(), password.unwrap_or_default());
    let hash = crate::auth::hash_password(&password)?;
    let now = s.now();
    let res = sqlx::query("INSERT INTO users (name, email, password, role_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(&name)
        .bind(&email)
        .bind(&hash)
        .bind(s.opt_str("app_default_role"))
        .bind(now)
        .bind(now)
        .execute(&state.db)
        .await?;
    let id = res.last_insert_id() as i64;

    let site = public_url(&state, &s).unwrap_or_default();
    let html = render_mail(
        &state,
        &s,
        Mail {
            greeting: format!("{} {},", state.t("Welcome").await, name),
            intro: vec![format!(
                "{}:",
                state.t("We confirm that you have successfully registered on our website, you can access using the following link").await
            )],
            action: Some((state.t("Access the site").await, if site.is_empty() { "/" } else { &site })),
            outro: vec![format!(
                "{}.",
                state
                    .t("If you have not registered yourself, someone has used this email address, we recommend that you contact the administrators")
                    .await
            )],
        },
    )
    .await;
    send_later(&state, email.clone(), state.t("Confirmation of your account registration").await, html);

    let token = crate::auth::create_token(&state, id, &token_name(&state).await).await?;
    let row = users::load(&state, id).await?;
    Ok(Json(json!({
        "message": state.t("Your registration successful").await,
        "token": token,
        "user": users::user_resource(&state, &row).await?,
    })))
}

async fn recover(State(state): State<AppState>, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    if !crate::middleware::login_allowed(&state, &headers) {
        return Err(too_many());
    }
    let s = state.settings.get().await;
    verify_captcha(&state, &s, &input, &headers).await?;
    let mut e = Errors::default();
    let email = input.opt_str("email");
    match &email {
        None => e.add("email", rules::required_msg("email")),
        Some(m) if !rules::is_email(m) => e.add("email", rules::email_msg("email")),
        _ => {}
    }
    e.check()?;
    // The same answer whether or not the address has an (active) account, so
    // the form can not be used to find out who has one.
    let sent = json!({ "message": state.t("An email has been sent with the password reset link").await });
    let email = email.unwrap_or_default();
    let user = Sql::new("SELECT id, name, email, status FROM users WHERE email = ? LIMIT 1")
        .push_args("", [email.clone()])
        .fetch_optional(&state.db)
        .await?;
    let Some(user) = user.filter(|u| u.i64("status") == 1) else {
        return Ok(Json(sent));
    };

    // Only a hash of the token is stored; the link carries the token itself.
    let token = crate::util::random_string(60);
    let mut tx = state.db.begin().await?;
    sqlx::query("DELETE FROM password_resets WHERE email = ?").bind(&email).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO password_resets (email, token, created_at) VALUES (?, ?, ?)")
        .bind(&email)
        .bind(sha256_hex(&token))
        .bind(s.now())
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    match public_url(&state, &s) {
        Some(base) => {
            let link = format!("{base}/auth/reset/{token}?email={}", urlencode(&user.str("email")));
            let html = render_mail(
                &state,
                &s,
                Mail {
                    greeting: format!("{} {},", state.t("Hi").await, user.str("name")),
                    intro: vec![format!(
                        "{}.",
                        state.t("You are receiving this email because we received a password reset request for your account").await
                    )],
                    action: Some((state.t("Reset password").await, &link)),
                    outro: vec![format!("{}.", state.t("If you did not request a password reset, no further action is required").await)],
                },
            )
            .await;
            send_later(&state, user.str("email"), state.t("Recover account").await, html);
        }
        None => tracing::warn!("password reset e-mail not sent: set APP_URL (or the app URL in Settings) so the link can be built"),
    }
    Ok(Json(sent))
}

async fn reset(State(state): State<AppState>, headers: HeaderMap, input: Input) -> AppResult<Json<Value>> {
    if !crate::middleware::login_allowed(&state, &headers) {
        return Err(too_many());
    }
    let s = state.settings.get().await;
    verify_captcha(&state, &s, &input, &headers).await?;
    let mut e = Errors::default();
    let token = input.opt_str("token");
    match &token {
        None => e.add("token", rules::required_msg("token")),
        Some(t) => {
            if rules::len(t) < 60 {
                e.add("token", rules::min_msg("token", 60));
            }
            if rules::len(t) > 60 {
                e.add("token", rules::max_msg("token", 60));
            }
        }
    }
    let password = check_new_password(&input, &mut e);
    e.check()?;
    let (token, password) = (token.unwrap_or_default(), password.unwrap_or_default());
    let incorrect = || AppError::not_acceptable("The recovery token is incorrect try again");

    let hashed = sha256_hex(&token);
    // Rows written by the previous release kept the token itself
    let row = Sql::new("SELECT email, token, created_at FROM password_resets WHERE token IN (?, ?) LIMIT 1")
        .push_args("", [hashed.clone(), token.clone()])
        .fetch_optional(&state.db)
        .await?;
    let Some(row) = row else { return Err(incorrect()) };
    let stored = row.str("token");
    if !(rules::secure_eq(stored.as_bytes(), hashed.as_bytes()) || rules::secure_eq(stored.as_bytes(), token.as_bytes())) {
        return Err(incorrect());
    }
    let email = row.str("email");
    let fresh = row
        .opt_str("created_at")
        .and_then(|c| crate::datefmt::parse(&c))
        .map(|c| (s.now() - c).num_minutes() < RESET_EXPIRE_MINUTES)
        .unwrap_or(false);
    if !fresh {
        sqlx::query("DELETE FROM password_resets WHERE email = ?").bind(&email).execute(&state.db).await?;
        return Err(incorrect());
    }
    if let Some(given) = input.opt_str("email") {
        if !given.eq_ignore_ascii_case(&email) {
            return Err(incorrect());
        }
    }
    let user = Sql::new("SELECT * FROM users WHERE email = ? LIMIT 1").push_args("", [email.clone()]).fetch_optional(&state.db).await?;
    let Some(user) = user else {
        return Err(AppError::not_acceptable("The email entered is not registered"));
    };
    if user.i64("status") != 1 {
        return Err(AppError::not_acceptable("The user is deactivated"));
    }
    let id = user.i64("id");
    let hash = crate::auth::hash_password(&password)?;
    let now = s.now();
    let mut tx = state.db.begin().await?;
    sqlx::query("UPDATE users SET password = ?, email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?")
        .bind(&hash)
        .bind(now)
        .bind(now)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM password_resets WHERE email = ?").bind(user.str("email")).execute(&mut *tx).await?;
    // Sessions opened with the old password end here
    sqlx::query("DELETE FROM personal_access_tokens WHERE tokenable_type = ? AND tokenable_id = ?")
        .bind(crate::auth::TOKENABLE_USER)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    let token = crate::auth::create_token(&state, id, &token_name(&state).await).await?;
    let row = users::load(&state, id).await?;
    Ok(Json(json!({
        "token": token,
        "user": users::user_resource(&state, &row).await?,
        "message": state.t("Password updated successfully").await,
    })))
}

async fn current_user(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    Ok(Json(users::user_resource(&state, &user.user).await?))
}

async fn check(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    let gate_pass = match input.opt_str("gate") {
        Some(g) if g != "0" => user.can(&g),
        _ => false,
    };
    let s = state.settings.get().await;
    let register = if s.modes().cashbooks {
        Sql::new("SELECT uuid FROM cash_books WHERE user_id = ? AND closed = 0 ORDER BY id LIMIT 1")
            .push_args("", [user.id])
            .fetch_optional(&state.db)
            .await?
            .map(|r| r.val("uuid"))
            .unwrap_or(Value::Null)
    } else {
        Value::Bool(true)
    };
    Ok(Json(json!({ "authorized": true, "gate_pass": gate_pass, "has_open_register": register })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_like_before() {
        assert_eq!(slug("The Float Nature Lodge_auth_token", '_'), "the_float_nature_lodge_auth_token");
        assert_eq!(slug("  Café & Bar -- POS_auth_token", '_'), "caf_bar_pos_auth_token");
        assert_eq!(slug("a@b_auth_token", '_'), "a_at_b_auth_token");
    }

    #[test]
    fn urlencodes_like_php() {
        assert_eq!(urlencode("a.b+c@d.com"), "a.b%2Bc%40d.com");
        assert_eq!(urlencode("a b"), "a+b");
    }

    #[test]
    fn dummy_hash_is_valid() {
        assert!(dummy_hash().starts_with("$2y$10$"));
        assert!(bcrypt::verify("x", dummy_hash()).is_ok());
    }

    #[test]
    fn escapes_html() {
        assert_eq!(html_escape("<a href=\"x\">&'"), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
    }
}
