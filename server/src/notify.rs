//! Customer notifications (mail, SMS, WhatsApp) for order events, using the
//! templates and gateways configured in Settings. Sending never blocks or
//! fails the request: it runs in the background and errors are only logged.

use crate::{db::RowExt, settings::Settings, state::AppState};
use anyhow::{anyhow, bail, Context};
use lettre::{
    message::{header::ContentType, Mailbox},
    transport::smtp::{
        authentication::Credentials,
        client::{Tls, TlsParameters},
    },
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderEvent {
    Created,
    Cancelled,
    Checkout,
}

impl OrderEvent {
    /// Settings column holding this event's template.
    fn template_column(self) -> &'static str {
        match self {
            OrderEvent::Created => "template_order_created",
            OrderEvent::Cancelled => "template_order_cancelled",
            OrderEvent::Checkout => "template_order_checkout",
        }
    }
}

/// Notify the customer of `sale_id` about `event` (call after the database
/// transaction has committed).
pub fn order_event(state: &AppState, sale_id: i64, event: OrderEvent) {
    let state = state.clone();
    tokio::spawn(async move {
        if let Err(e) = notify_customer(&state, sale_id, event).await {
            tracing::warn!(sale_id, ?event, error = %format!("{e:#}"), "customer notification failed");
        }
    });
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Channel {
    Mail,
    WhatsApp,
    Vonage,
    TwilioSms,
}

/// Which channels reach this customer. The "Send notifications to customer"
/// switch (advance_send_notification) turns all of them off.
fn channels(s: &Settings, email: Option<&str>, phone: Option<&str>) -> Vec<Channel> {
    let mut list = vec![];
    if !s.flag("advance_send_notification") {
        return list;
    }
    if email.is_some() {
        list.push(Channel::Mail);
    }
    if phone.is_some() && s.flag("wa_status") {
        list.push(Channel::WhatsApp);
    }
    if phone.is_some() && s.flag("sms_status") {
        match s.opt_str("sms_channel").as_deref() {
            Some("nexmo") => list.push(Channel::Vonage),
            Some("twilio") => list.push(Channel::TwilioSms),
            _ => {}
        }
    }
    list
}

/// The event's template (`subject`, `mail_content`, `sms_content`), or the
/// built-in fallback when none was saved.
fn template(s: &Settings, event: OrderEvent) -> Value {
    let saved = match s.val(event.template_column()) {
        Value::String(t) => serde_json::from_str::<Value>(&t).ok(),
        Value::Object(o) => Some(Value::Object(o)),
        _ => None,
    };
    saved.filter(Value::is_object).unwrap_or_else(
        || json!({ "mail_content": "Check at {order_link}", "sms_content": "Check at {tracking_link}", "subject": " # {tracking_id}" }),
    )
}

/// Replace `{name}` placeholders; unknown ones stay as they are.
pub fn fill(template: &str, vars: &[(&str, String)], escape: bool) -> String {
    let mut out = String::with_capacity(template.len() + 64);
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('}') {
            Some(end) if end > 0 => {
                let key = &after[..end];
                match vars.iter().find(|(k, _)| *k == key) {
                    Some((_, v)) => out.push_str(&if escape { html_escape(v) } else { v.clone() }),
                    None => {
                        out.push('{');
                        out.push_str(key);
                        out.push('}');
                    }
                }
                rest = &after[end + 1..];
            }
            _ => {
                out.push('{');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

pub fn html_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#039;"),
            other => out.push(other),
        }
    }
    out
}

/// Public address of the app for links in messages.
fn base_url(state: &AppState, s: &Settings) -> String {
    if !state.cfg.app_url.is_empty() {
        state.cfg.app_url.clone()
    } else {
        s.str("app_url").trim_end_matches('/').to_string()
    }
}

async fn notify_customer(state: &AppState, sale_id: i64, event: OrderEvent) -> anyhow::Result<()> {
    let sale = sqlx::query("SELECT id, uuid, tracking, customer_id, created_at FROM sales WHERE id = ?")
        .bind(sale_id)
        .fetch_optional(&state.db)
        .await?
        .map(|r| crate::db::row_json(&r));
    let Some(sale) = sale else { return Ok(()) };
    let Some(customer_id) = sale.opt_i64("customer_id") else { return Ok(()) };
    let customer = sqlx::query("SELECT name, email, phone FROM customers WHERE id = ?")
        .bind(customer_id)
        .fetch_optional(&state.db)
        .await?
        .map(|r| crate::db::row_json(&r));
    let Some(customer) = customer else { return Ok(()) };

    let s = state.settings.get().await;
    let email = customer.opt_str("email").filter(|e| !e.trim().is_empty());
    let phone = customer.opt_str("phone").filter(|p| !p.trim().is_empty());
    let list = channels(&s, email.as_deref(), phone.as_deref());
    if list.is_empty() {
        return Ok(());
    }
    let tpl = template(&s, event);
    let part = |k: &str| tpl.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let vars: Vec<(&str, String)> = vec![
        ("tracking_id", sale.str("tracking")),
        ("customer_name", customer.str("name")),
        ("order_link", format!("{}/print/sale/{}", base_url(state, &s), sale.str("uuid"))),
        ("order_date", sale.str("created_at")),
        ("company_name", s.str("app_name")),
    ];
    let sms_text = fill(&part("sms_content"), &vars, false);

    for channel in list {
        let result = match channel {
            Channel::Mail => {
                let subject = fill(&part("subject"), &vars, false);
                let html = fill(&part("mail_content"), &vars, true);
                send_mail(state, email.as_deref().unwrap_or_default(), &subject, &html).await
            }
            Channel::WhatsApp => send_whatsapp(state, &s, phone.as_deref().unwrap_or_default(), &sms_text).await,
            Channel::Vonage => send_vonage(state, &s, phone.as_deref().unwrap_or_default(), &sms_text).await,
            Channel::TwilioSms => send_twilio_sms(state, &s, phone.as_deref().unwrap_or_default(), &sms_text).await,
        };
        if let Err(e) = result {
            tracing::warn!(sale_id, ?event, ?channel, error = %format!("{e:#}"), "customer notification not sent");
        }
    }
    Ok(())
}

/* --------------------------------------------------------------------- mail */

/// Send one e-mail with the outgoing mail settings (Settings > Outgoing mail).
/// Returns an error when mail is not configured or the server refuses it.
pub async fn send_mail(state: &AppState, to: &str, subject: &str, html: &str) -> anyhow::Result<()> {
    let s = state.settings.get().await;
    let from_address = s.opt_str("mail_from_address").ok_or_else(|| anyhow!("mail is not configured (no sender address)"))?;
    let from = Mailbox::new(s.opt_str("mail_from_name"), from_address.parse().context("invalid sender address")?);
    let to_box: Mailbox = to.parse().context("invalid recipient address")?;
    let mailer = s.opt_str("mail_mailer").unwrap_or_else(|| "log".into());

    if mailer == "mailgun" {
        return send_mailgun(state, &s, &from, to, subject, html).await;
    }
    let message = Message::builder()
        .from(from)
        .to(to_box)
        .subject(subject)
        .header(ContentType::TEXT_HTML)
        .body(html.to_string())
        .context("could not build the message")?;

    match mailer.as_str() {
        "smtp" => {
            let host = s.opt_str("mail_host").ok_or_else(|| anyhow!("SMTP host is not set"))?;
            let port: u16 = s.str("mail_port").trim().parse().unwrap_or(587);
            let encryption = s.opt_str("mail_encryption").unwrap_or_default().to_ascii_lowercase();
            let params = TlsParameters::new(host.clone()).context("TLS setup failed")?;
            // ssl (or port 465): TLS from the start; tls: STARTTLS required;
            // none: STARTTLS when the server offers it
            let tls = if encryption == "ssl" || port == 465 {
                Tls::Wrapper(params)
            } else if encryption == "tls" {
                Tls::Required(params)
            } else {
                Tls::Opportunistic(params)
            };
            let mut builder =
                AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host).port(port).tls(tls).timeout(Some(Duration::from_secs(20)));
            if let Some(user) = s.opt_str("mail_username") {
                builder = builder.credentials(Credentials::new(user, s.opt_str("mail_password").unwrap_or_default()));
            }
            builder.build().send(message).await.context("SMTP server refused the message")?;
            Ok(())
        }
        "sendmail" => {
            use tokio::io::AsyncWriteExt;
            let mut child = tokio::process::Command::new("/usr/sbin/sendmail")
                .args(["-t", "-i"])
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .kill_on_drop(true)
                .spawn()
                .context("sendmail is not available")?;
            if let Some(mut stdin) = child.stdin.take() {
                stdin.write_all(&message.formatted()).await?;
            }
            let status = tokio::time::timeout(Duration::from_secs(30), child.wait()).await.context("sendmail timed out")??;
            if !status.success() {
                bail!("sendmail exited with {status}");
            }
            Ok(())
        }
        // "log" and anything unknown: keep the mail in the server log
        _ => {
            tracing::info!(target: "mail", to = %to, subject = %subject, body = %html, "mail (log mailer)");
            Ok(())
        }
    }
}

async fn send_mailgun(state: &AppState, s: &Settings, from: &Mailbox, to: &str, subject: &str, html: &str) -> anyhow::Result<()> {
    let domain = s.opt_str("mailgun_domain").ok_or_else(|| anyhow!("Mailgun domain is not set"))?;
    let secret = s.opt_str("mailgun_secret").ok_or_else(|| anyhow!("Mailgun secret is not set"))?;
    let endpoint = s.opt_str("mailgun_endpoint").unwrap_or_else(|| "api.mailgun.net".into());
    let host = endpoint.trim_start_matches("https://").trim_start_matches("http://").trim_end_matches('/');
    if host.is_empty() || !host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
        bail!("invalid Mailgun endpoint");
    }
    if !domain.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
        bail!("invalid Mailgun domain");
    }
    let res = state
        .http
        .post(format!("https://{host}/v3/{domain}/messages"))
        .basic_auth("api", Some(secret))
        .form(&[("from", from.to_string()), ("to", to.to_string()), ("subject", subject.to_string()), ("html", html.to_string())])
        .send()
        .await
        .context("Mailgun is not reachable")?;
    if !res.status().is_success() {
        bail!("Mailgun answered {}", res.status());
    }
    Ok(())
}

/* ----------------------------------------------------------- SMS, WhatsApp */

async fn twilio_send(state: &AppState, sid: &str, token: &str, from: &str, to: &str, body: &str) -> anyhow::Result<()> {
    if sid.is_empty() || !sid.chars().all(|c| c.is_ascii_alphanumeric()) {
        bail!("Twilio account SID is not set");
    }
    let res = state
        .http
        .post(format!("https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"))
        .basic_auth(sid, Some(token))
        .form(&[("To", to), ("From", from), ("Body", body)])
        .send()
        .await
        .context("Twilio is not reachable")?;
    if !res.status().is_success() {
        let status = res.status();
        let detail: Value = res.json().await.unwrap_or(Value::Null);
        bail!("Twilio answered {status} (code {})", detail.get("code").cloned().unwrap_or(Value::Null));
    }
    Ok(())
}

async fn send_whatsapp(state: &AppState, s: &Settings, phone: &str, text: &str) -> anyhow::Result<()> {
    if text.is_empty() {
        bail!("The message content is missing");
    }
    let from = format!("whatsapp:+{}", s.str("wa_twilio_from").trim().trim_start_matches('+'));
    twilio_send(state, &s.str("wa_twilio_account_sid"), &s.str("wa_twilio_auth_token"), &from, &format!("whatsapp:{}", phone.trim()), text)
        .await
}

async fn send_twilio_sms(state: &AppState, s: &Settings, phone: &str, text: &str) -> anyhow::Result<()> {
    twilio_send(state, &s.str("twilio_account_sid"), &s.str("twilio_auth_token"), &s.str("twilio_from"), phone.trim(), text).await
}

async fn send_vonage(state: &AppState, s: &Settings, phone: &str, text: &str) -> anyhow::Result<()> {
    let key = s.opt_str("vonage_key").ok_or_else(|| anyhow!("Vonage key is not set"))?;
    let res = state
        .http
        .post("https://rest.nexmo.com/sms/json")
        .form(&[
            ("api_key", key),
            ("api_secret", s.str("vonage_secret")),
            ("from", s.str("vonage_from")),
            ("to", phone.trim().to_string()),
            ("text", text.to_string()),
            ("type", if text.is_ascii() { "text" } else { "unicode" }.to_string()),
        ])
        .send()
        .await
        .context("Vonage is not reachable")?;
    let body: Value = res.json().await.context("unexpected Vonage answer")?;
    let first = body.get("messages").and_then(|m| m.get(0));
    let status = first.and_then(|m| m.get("status")).and_then(Value::as_str).unwrap_or("?");
    if status != "0" {
        bail!(
            "Vonage refused the message (status {status}: {})",
            first.and_then(|m| m.get("error-text")).and_then(Value::as_str).unwrap_or("")
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholders() {
        let vars = vec![("customer_name", "<b>Ann</b>".to_string()), ("tracking_id", "42".to_string())];
        assert_eq!(fill("Hi {customer_name} #{tracking_id} {other}", &vars, false), "Hi <b>Ann</b> #42 {other}");
        assert_eq!(fill("<p>{customer_name}</p>", &vars, true), "<p>&lt;b&gt;Ann&lt;/b&gt;</p>");
        assert_eq!(fill("{ {} {", &vars, false), "{ {} {");
    }

    #[test]
    fn channel_choice() {
        let mut s = Settings::default();
        s.row.insert("advance_send_notification".into(), json!(1));
        s.row.insert("wa_status".into(), json!(1));
        s.row.insert("sms_status".into(), json!(1));
        s.row.insert("sms_channel".into(), json!("twilio"));
        assert_eq!(channels(&s, Some("a@b.c"), Some("+1")), vec![Channel::Mail, Channel::WhatsApp, Channel::TwilioSms]);
        assert_eq!(channels(&s, None, None), vec![]);
        s.row.insert("advance_send_notification".into(), json!(0));
        assert!(channels(&s, Some("a@b.c"), Some("+1")).is_empty());
    }

    #[test]
    fn fallback_template() {
        let s = Settings::default();
        assert_eq!(template(&s, OrderEvent::Created)["subject"], json!(" # {tracking_id}"));
    }
}
