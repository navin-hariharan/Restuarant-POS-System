use crate::{config::Config, db::Db, i18n::Lang, middleware::RateLimiter, settings::SettingsStore};
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<Config>,
    pub db: Db,
    pub settings: SettingsStore,
    pub lang: Lang,
    pub http: reqwest::Client,
    /// Serializes backup/restore jobs so two never run at once
    pub maintenance: Arc<tokio::sync::Mutex<()>>,
    pub limiter: RateLimiter,
}

impl AppState {
    /// Translate a server message into the app's language.
    pub async fn t(&self, key: &str) -> String {
        self.tp(key, &[]).await
    }

    pub async fn tp(&self, key: &str, params: &[(&str, &str)]) -> String {
        let s = self.settings.get().await;
        let locale = s.opt_str("app_locale").unwrap_or_else(|| "en".into());
        self.lang.t(&locale, key, params).await
    }

    /// Public URL of a stored upload ("avatar/abc.png" -> https://host/storage/avatar/abc.png)
    pub fn storage_url(&self, path: &str) -> String {
        format!("{}/storage/{}", self.cfg.app_url, path.trim_start_matches('/'))
    }

    /// Public URL of a file shipped with the web app ("images/default/product.png")
    pub fn asset_url(&self, path: &str) -> String {
        format!("{}/{}", self.cfg.app_url, path.trim_start_matches('/'))
    }
}
