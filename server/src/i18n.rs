//! Translations. Each language is a JSON file `<data>/lang/<locale>.json`
//! mapping English text to its translation, edited from the Languages screen.
//! English ships with the app (`lang/en.json`, embedded in the binary); on
//! start any strings added by a new release are merged into the saved files
//! without touching translations already made.

use serde_json::{Map, Value};
use std::{collections::HashMap, path::PathBuf, sync::Arc};
use tokio::sync::RwLock;

pub const DEFAULT_EN: &str = include_str!("../lang/en.json");

/// Loaded translation files by locale
type Cache = Arc<RwLock<HashMap<String, Arc<Map<String, Value>>>>>;

#[derive(Clone)]
pub struct Lang {
    dir: PathBuf,
    cache: Cache,
}

impl Lang {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir, cache: Default::default() }
    }

    pub fn dir(&self) -> &PathBuf {
        &self.dir
    }

    /// Valid locale codes only (letters, digits, - and _), so they are safe in file names.
    pub fn valid_locale(locale: &str) -> bool {
        !locale.is_empty() && locale.len() <= 16 && locale.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    }

    pub fn path(&self, locale: &str) -> Option<PathBuf> {
        Self::valid_locale(locale).then(|| self.dir.join(format!("{locale}.json")))
    }

    pub fn default_en() -> Map<String, Value> {
        serde_json::from_str(DEFAULT_EN).unwrap_or_default()
    }

    /// Create the folder and merge new English strings into every saved file.
    pub async fn init(&self) -> anyhow::Result<()> {
        tokio::fs::create_dir_all(&self.dir).await?;
        let shipped = Self::default_en();
        let mut entries = tokio::fs::read_dir(&self.dir).await?;
        let mut seen_en = false;
        while let Some(e) = entries.next_entry().await? {
            let name = e.file_name().to_string_lossy().to_string();
            let Some(locale) = name.strip_suffix(".json") else { continue };
            if !Self::valid_locale(locale) {
                continue;
            }
            seen_en |= locale == "en";
            let mut current = match self.read_file(locale).await {
                Some(m) => m,
                None => {
                    tracing::warn!(file = %name, "translation file is not valid JSON, leaving it as it is");
                    continue;
                }
            };
            let before = current.len();
            for (k, v) in &shipped {
                if !current.contains_key(k) {
                    // English text for new strings until someone translates them
                    current.insert(k.clone(), if locale == "en" { v.clone() } else { Value::from(k.clone()) });
                }
            }
            if current.len() != before {
                self.write(locale, &current).await?;
            }
        }
        if !seen_en {
            self.write("en", &shipped).await?;
        }
        Ok(())
    }

    async fn read_file(&self, locale: &str) -> Option<Map<String, Value>> {
        let path = self.path(locale)?;
        let text = tokio::fs::read_to_string(path).await.ok()?;
        serde_json::from_str::<Map<String, Value>>(&text).ok()
    }

    /// Translations for a locale (cached). Missing file = empty map.
    pub async fn get(&self, locale: &str) -> Arc<Map<String, Value>> {
        if let Some(m) = self.cache.read().await.get(locale) {
            return m.clone();
        }
        let m = Arc::new(self.read_file(locale).await.unwrap_or_default());
        self.cache.write().await.insert(locale.to_string(), m.clone());
        m
    }

    pub async fn exists(&self, locale: &str) -> bool {
        match self.path(locale) {
            Some(p) => tokio::fs::try_exists(p).await.unwrap_or(false),
            None => false,
        }
    }

    /// Atomic write (temp file + rename) and cache refresh.
    pub async fn write(&self, locale: &str, map: &Map<String, Value>) -> anyhow::Result<()> {
        let path = self.path(locale).ok_or_else(|| anyhow::anyhow!("invalid locale"))?;
        let tmp = path.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(map)?;
        tokio::fs::write(&tmp, text).await?;
        tokio::fs::rename(&tmp, &path).await?;
        self.cache.write().await.insert(locale.to_string(), Arc::new(map.clone()));
        Ok(())
    }

    pub async fn delete(&self, locale: &str) -> anyhow::Result<()> {
        if let Some(p) = self.path(locale) {
            if tokio::fs::try_exists(&p).await.unwrap_or(false) {
                tokio::fs::remove_file(p).await?;
            }
        }
        self.cache.write().await.remove(locale);
        Ok(())
    }

    /// Forget cached files so the next read loads them from disk (after a
    /// restore or a files archive import).
    pub async fn clear_cache(&self) {
        self.cache.write().await.clear();
    }

    /// Translate `key` into `locale`, replacing `:name` placeholders.
    pub async fn t(&self, locale: &str, key: &str, params: &[(&str, &str)]) -> String {
        let map = self.get(locale).await;
        let text = map.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or(key);
        replace_params(text, params)
    }
}

pub fn replace_params(text: &str, params: &[(&str, &str)]) -> String {
    let mut out = text.to_string();
    // longest names first so :name doesn't clobber :names
    let mut ps: Vec<_> = params.to_vec();
    ps.sort_by_key(|(k, _)| std::cmp::Reverse(k.len()));
    for (k, v) in ps {
        out = out.replace(&format!(":{k}"), v);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn params() {
        assert_eq!(replace_params(":count of :countMax", &[("count", "2"), ("countMax", "5")]), "2 of 5");
    }
}
