//! Settings > Activity logs, and the signed-in user's own recent actions.

use crate::{
    auth::AuthUser,
    db::RowExt,
    error::AppResult,
    input::Input,
    query::{paged, Sql},
    state::AppState,
};
use axum::{extract::State, routing::get, Json, Router};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

pub fn router() -> Router<AppState> {
    Router::new().route("/admin/activity-logs", get(all_logs)).route("/admin/my-activity-logs", get(my_logs))
}

/// Logs as JSON with the user's name (one query for all names).
async fn log_list(state: &AppState, rows: &[Map<String, Value>]) -> AppResult<Vec<Value>> {
    let s = state.settings.get().await;
    let mut ids: Vec<i64> = rows.iter().map(|r| r.i64("user_id")).collect();
    ids.sort_unstable();
    ids.dedup();
    let mut names: HashMap<i64, Value> = HashMap::new();
    if !ids.is_empty() {
        let mut q = Sql::new("SELECT id, name FROM users WHERE 1=1");
        q.and_in("id", ids);
        for r in q.fetch_all(&state.db).await? {
            names.insert(r.i64("id"), r.val("name"));
        }
    }
    let demo = state.cfg.demo_mode;
    Ok(rows
        .iter()
        .map(|r| {
            json!({
                "id": r.val("id"),
                "user": names.get(&r.i64("user_id")).cloned().unwrap_or(Value::Null),
                "ip": if demo { json!("x.x.x.x") } else { r.val("ip") },
                "activity": r.val("activity"),
                "device": if demo {
                    json!("... xxxx ... (Device & IP information hidden due to privacy protection while in demo mode)")
                } else {
                    r.val("device")
                },
                "link": r.val("link"),
                "created_at": s.fmt_value(&r.val("created_at")),
                "updated_at": s.fmt_value(&r.val("updated_at")),
            })
        })
        .collect())
}

async fn all_logs(State(state): State<AppState>, user: AuthUser, input: Input) -> AppResult<Json<Value>> {
    user.require(&["activity_logs"])?;
    let s = state.settings.get().await;
    let mut q = Sql::new("SELECT * FROM user_activity_logs WHERE 1=1");
    if let Some(search) = input.opt_str("search") {
        let p = s.search_pattern(&search);
        q.push_args(" AND (activity LIKE ? OR ip LIKE ? OR device LIKE ? OR link LIKE ?)", [p.clone(), p.clone(), p.clone(), p]);
    }
    if let Some(u) = input.opt_str("user").or_else(|| input.opt_str("user_id")) {
        q.and("user_id = ?", u);
    }
    let (col, dir) = input.sort(&["id", "user_id", "activity", "device", "ip", "link", "created_at", "updated_at"], "created_at", "asc");
    q.push(&format!(" ORDER BY `{col}` {dir}"));
    let (rows, p) = q.paginate(&state.db, input.page(10)).await?;
    Ok(Json(paged(log_list(&state, &rows).await?, p)))
}

async fn my_logs(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    let rows = Sql::new("SELECT * FROM user_activity_logs WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50")
        .push_args("", [user.id])
        .fetch_all(&state.db)
        .await?;
    Ok(Json(Value::Array(log_list(&state, &rows).await?)))
}
