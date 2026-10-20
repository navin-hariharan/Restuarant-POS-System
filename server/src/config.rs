//! Process configuration, read once from environment variables.
//!
//! Only deployment values live here (where to listen, which database, where to
//! keep files). Everything an admin can change from the Settings screens is
//! stored in the database `settings` row, see `settings.rs`.

use std::{env, path::PathBuf};

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    /// Public address, e.g. https://pos.example.com (no trailing slash).
    /// Empty means links are relative to whatever host the browser used.
    pub app_url: String,
    pub db: DbConfig,
    /// Persistent data: uploads/, backups/, lang/
    pub data_dir: PathBuf,
    /// Built web app (index.html + assets)
    pub web_dir: PathBuf,
    /// Seconds to wait for the database at startup
    pub db_wait_secs: u64,
    /// Manual backups kept before new ones are refused
    pub backups_limit: usize,
    /// API requests per minute per user (or IP when signed out)
    pub throttle_per_minute: u32,
    /// Proxies in front of the app that append to X-Forwarded-For (0: none,
    /// use the connection's address).
    pub trusted_proxies: usize,
    /// Take X-Real-IP when there is no X-Forwarded-For.
    pub trust_real_ip: bool,
    /// Demo mode blocks destructive actions
    pub demo_mode: bool,
    /// First administrator of a brand-new database
    pub admin_name: String,
    pub admin_email: String,
    pub admin_password: Option<String>,
    /// Largest accepted upload for backups (bytes)
    pub max_backup_upload: u64,
    /// mariadb client binaries used for backups and restores
    pub dump_bin: String,
    pub client_bin: String,
}

#[derive(Debug, Clone)]
pub struct DbConfig {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: String,
}

fn var(key: &str) -> Option<String> {
    env::var(key).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn var_or(key: &str, default: &str) -> String {
    var(key).unwrap_or_else(|| default.to_string())
}

fn flag(key: &str) -> bool {
    matches!(var(key).as_deref().map(str::to_ascii_lowercase).as_deref(), Some("1" | "true" | "yes" | "on"))
}

fn num<T: std::str::FromStr>(key: &str, default: T) -> T {
    var(key).and_then(|v| v.parse().ok()).unwrap_or(default)
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let db = match var("DATABASE_URL") {
            Some(url) => parse_database_url(&url)?,
            None => DbConfig {
                host: var_or("DB_HOST", "127.0.0.1"),
                port: num("DB_PORT", 3306),
                database: var_or("DB_DATABASE", "pos"),
                username: var_or("DB_USERNAME", "pos"),
                password: env::var("DB_PASSWORD").unwrap_or_default(),
            },
        };
        let data_dir = PathBuf::from(var_or("DATA_DIR", "./data"));
        Ok(Self {
            port: num("PORT", 8080),
            app_url: var_or("APP_URL", "").trim_end_matches('/').to_string(),
            db,
            web_dir: PathBuf::from(var_or("WEB_DIR", "../web/dist")),
            data_dir,
            db_wait_secs: num("DB_WAIT_SECONDS", 90),
            backups_limit: num("DB_BACKUPS_LIMIT", 10),
            throttle_per_minute: num("THROTTLE_MAX_ATTEMPTS", 120),
            trusted_proxies: num("TRUSTED_PROXIES", 1),
            trust_real_ip: flag("TRUST_X_REAL_IP"),
            demo_mode: flag("DEMO_MODE"),
            admin_name: var_or("ADMIN_NAME", "Administrator"),
            admin_email: var_or("ADMIN_EMAIL", "admin@example.com"),
            admin_password: var("ADMIN_PASSWORD"),
            max_backup_upload: num::<u64>("MAX_BACKUP_UPLOAD_MB", 1024) * 1024 * 1024,
            dump_bin: var_or("MYSQLDUMP_PATH", "mariadb-dump"),
            client_bin: var_or("MYSQL_CLIENT_PATH", "mariadb"),
        })
    }

    pub fn uploads_dir(&self) -> PathBuf {
        self.data_dir.join("uploads")
    }
    pub fn backups_dir(&self) -> PathBuf {
        self.data_dir.join("backups")
    }
    pub fn lang_dir(&self) -> PathBuf {
        self.data_dir.join("lang")
    }
    pub fn tmp_dir(&self) -> PathBuf {
        self.data_dir.join("tmp")
    }
}

/// mysql://user:pass@host:port/db
fn parse_database_url(url: &str) -> anyhow::Result<DbConfig> {
    let rest = url
        .strip_prefix("mysql://")
        .or_else(|| url.strip_prefix("mariadb://"))
        .ok_or_else(|| anyhow::anyhow!("DATABASE_URL must start with mysql:// or mariadb://"))?;
    let (creds, hostpart) = rest.rsplit_once('@').ok_or_else(|| anyhow::anyhow!("DATABASE_URL has no user"))?;
    let (username, password) = creds.split_once(':').unwrap_or((creds, ""));
    let (hostport, database) = hostpart.split_once('/').ok_or_else(|| anyhow::anyhow!("DATABASE_URL has no database name"))?;
    let database = database.split('?').next().unwrap_or_default();
    let (host, port) = match hostport.rsplit_once(':') {
        Some((h, p)) => (h.to_string(), p.parse().unwrap_or(3306)),
        None => (hostport.to_string(), 3306),
    };
    let decode = |s: &str| percent_decode(s);
    Ok(DbConfig { host, port, database: decode(database), username: decode(username), password: decode(password) })
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_database_url() {
        let c = parse_database_url("mysql://pos:p%40ss@db:3307/pos_main?ssl-mode=disabled").unwrap();
        assert_eq!(c.host, "db");
        assert_eq!(c.port, 3307);
        assert_eq!(c.username, "pos");
        assert_eq!(c.password, "p@ss");
        assert_eq!(c.database, "pos_main");
    }
}
