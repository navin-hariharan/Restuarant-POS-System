//! Database schema: create it on an empty database, recognise a database from
//! an earlier release, apply pending migrations and seed what the app needs.
//!
//! The schema and the `migrations` table stay identical to earlier releases,
//! so their backups restore here and this database stays readable by them.
//! Runs at startup and again after every restore.

use crate::{auth::hash_password, config::Config, db::Db};
use anyhow::{bail, Context};
use sqlx::Row;

const SCHEMA: &str = include_str!("../sql/schema.sql");
const BASELINE: &str = include_str!("../sql/baseline_migrations.txt");
const LOCK: &str = "pos_app_schema";

/// Data migrations added after the baseline, in order. Names follow the
/// `migrations` table convention so every release records them the same way.
const MIGRATIONS: &[(&str, &str)] = &[
    (
        "2026_10_18_000001_fix_manager_overall_report_permission",
        // The seeded Manager role carried a key nothing checks; give it the two
        // report permissions it was meant to have.
        r#"UPDATE user_roles
        SET permissions = JSON_ARRAY_APPEND(JSON_ARRAY_APPEND(JSON_REMOVE(permissions, JSON_UNQUOTE(JSON_SEARCH(permissions, 'one', 'overall_report'))), '$', 'overall_sale_report'), '$', 'overall_expense_report')
        WHERE JSON_VALID(permissions) AND JSON_SEARCH(permissions, 'one', 'overall_report') IS NOT NULL
          AND JSON_SEARCH(permissions, 'one', 'overall_sale_report') IS NULL"#,
    ),
    (
        "2026_10_18_000002_drop_leftover_overall_report_key",
        r#"UPDATE user_roles
        SET permissions = JSON_REMOVE(permissions, JSON_UNQUOTE(JSON_SEARCH(permissions, 'one', 'overall_report')))
        WHERE JSON_VALID(permissions) AND JSON_SEARCH(permissions, 'one', 'overall_report') IS NOT NULL"#,
    ),
    (
        "2026_10_20_000001_create_digital_menu_email_otps_table",
        // One row per e-mail code sent from the digital menu; holds only hashes.
        r#"CREATE TABLE IF NOT EXISTS `digital_menu_email_otps` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `email` varchar(191) NOT NULL,
  `table_id` bigint(20) unsigned NOT NULL,
  `code_hash` char(64) NOT NULL,
  `salt` char(16) NOT NULL,
  `attempts` int(10) unsigned NOT NULL DEFAULT 0,
  `ip` varchar(191) DEFAULT NULL,
  `expires_at` timestamp NULL DEFAULT NULL,
  `verified_at` timestamp NULL DEFAULT NULL,
  `token_hash` char(64) DEFAULT NULL,
  `token_expires_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `digital_menu_email_otps_email_created_at_index` (`email`,`created_at`),
  KEY `digital_menu_email_otps_token_hash_index` (`token_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"#,
    ),
];

/// Tables every POS database has
const MARKERS: [&str; 5] = ["users", "settings", "sales", "food_items", "user_roles"];

/// Lookup indexes added for speed (uuid route lookups, date-range reports).
/// Created when missing; harmless for older releases reading this database.
const INDEXES: &[(&str, &str, &str)] = &[
    ("sales", "pos_sales_uuid_index", "uuid"),
    ("sales", "pos_sales_created_at_index", "created_at"),
    ("sale_items", "pos_sale_items_created_at_index", "created_at"),
    ("expenses", "pos_expenses_created_at_index", "created_at"),
    ("food_items", "pos_food_items_uuid_index", "uuid"),
    ("customers", "pos_customers_uuid_index", "uuid"),
    ("cash_books", "pos_cash_books_uuid_index", "uuid"),
    ("guest_room_reservations", "pos_guest_room_reservations_uuid_index", "uuid"),
    ("user_activity_logs", "pos_user_activity_logs_user_id_index", "user_id"),
    ("user_activity_logs", "pos_user_activity_logs_created_at_index", "created_at"),
];

async fn ensure_indexes(db: &Db) -> anyhow::Result<()> {
    for (table, name, column) in INDEXES {
        let present: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
        )
        .bind(table)
        .bind(name)
        .fetch_one(db)
        .await?;
        if present == 0 && has_column(db, table, column).await? {
            sqlx::query(&format!("ALTER TABLE `{table}` ADD INDEX `{name}` (`{column}`)")).execute(db).await?;
            tracing::info!(table = %table, column = %column, "added index");
        }
    }
    Ok(())
}

#[derive(Debug, Default)]
pub struct Report {
    pub created: bool,
    pub adopted: bool,
    pub migrated: Vec<String>,
    pub seeded: bool,
    pub admin_password: Option<String>,
}

pub async fn run(db: &Db, cfg: &Config) -> anyhow::Result<Report> {
    let mut conn = db.acquire().await?;
    let got: Option<i64> = sqlx::query_scalar("SELECT GET_LOCK(?, 600)").bind(LOCK).fetch_one(&mut *conn).await?;
    if got != Some(1) {
        bail!("another instance is updating the database schema");
    }
    let result = run_locked(db, cfg).await;
    let _ = sqlx::query("SELECT RELEASE_LOCK(?)").bind(LOCK).execute(&mut *conn).await;
    result
}

async fn tables(db: &Db) -> anyhow::Result<Vec<String>> {
    let rows = sqlx::query("SHOW TABLES").fetch_all(db).await?;
    Ok(rows.iter().filter_map(|r| r.try_get::<String, _>(0).ok()).collect())
}

/// Columns added after the baseline: (table, column, definition). Added when
/// missing (an older database, or a backup from before they existed); older
/// releases reading this database ignore them.
const COLUMNS: &[(&str, &str, &str)] = &[
    ("service_tables", "seating_pin", "varchar(6) NULL DEFAULT NULL"),
    ("service_tables", "seating_started_at", "timestamp NULL DEFAULT NULL"),
    ("service_tables", "pin_failed_attempts", "int(10) unsigned NOT NULL DEFAULT 0"),
    ("service_tables", "pin_locked_until", "timestamp NULL DEFAULT NULL"),
    ("settings", "digital_menu_require_pin", "tinyint(1) NOT NULL DEFAULT 1"),
    ("settings", "seating_pin_max_hours", "int(10) unsigned NOT NULL DEFAULT 8"),
    ("settings", "digital_menu_verify_email", "tinyint(1) NOT NULL DEFAULT 1"),
];

async fn ensure_columns(db: &Db) -> anyhow::Result<()> {
    for (table, column, definition) in COLUMNS {
        if !has_column(db, table, column).await? {
            sqlx::query(&format!("ALTER TABLE `{table}` ADD COLUMN `{column}` {definition}")).execute(db).await?;
            tracing::info!(table = %table, column = %column, "added column");
        }
    }
    Ok(())
}

async fn has_column(db: &Db, table: &str, column: &str) -> anyhow::Result<bool> {
    let n: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    )
    .bind(table)
    .bind(column)
    .fetch_one(db)
    .await?;
    Ok(n > 0)
}

fn statements(sql: &str) -> impl Iterator<Item = &str> {
    sql.split(";\n").map(str::trim).filter(|s| !s.is_empty())
}

fn baseline() -> Vec<&'static str> {
    BASELINE.lines().map(str::trim).filter(|l| !l.is_empty()).collect()
}

async fn run_locked(db: &Db, cfg: &Config) -> anyhow::Result<Report> {
    let mut report = Report::default();
    let existing = tables(db).await?;
    let has = |t: &str| existing.iter().any(|e| e == t);
    let history = has("migrations") && sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM migrations").fetch_one(db).await? > 0;
    // Fresh: no migration history and no users, settings or sales yet. A run
    // that stopped half-way is fresh too, as every CREATE is IF NOT EXISTS.
    let mut fresh = !history;
    for t in ["users", "settings", "sales"] {
        if fresh && has(t) {
            fresh = sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM `{t}`")).fetch_one(db).await? == 0;
        }
    }

    if fresh {
        tracing::info!("empty database: creating the schema");
        // One connection, so the foreign key switch covers every statement
        let mut conn = db.acquire().await?;
        sqlx::query("SET FOREIGN_KEY_CHECKS = 0").execute(&mut *conn).await?;
        let mut result = Ok(());
        for stmt in statements(SCHEMA) {
            let stmt = stmt.replacen("CREATE TABLE `", "CREATE TABLE IF NOT EXISTS `", 1);
            if let Err(e) = sqlx::query(&stmt).execute(&mut *conn).await {
                result = Err(anyhow::Error::from(e).context(format!("schema statement failed: {}", &stmt[..stmt.len().min(80)])));
                break;
            }
        }
        sqlx::query("SET FOREIGN_KEY_CHECKS = 1").execute(&mut *conn).await?;
        drop(conn);
        result?;
        record(db, &baseline(), 1).await?;
        report.created = true;
    } else {
        let has_history: bool = existing.iter().any(|t| t == "migrations")
            && sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM migrations").fetch_one(db).await? > 0;
        if !has_history {
            for t in MARKERS {
                if !has(t) {
                    bail!(
                        "this database is not a POS database (table `{t}` is missing); point DB_DATABASE at a POS database or an empty one"
                    );
                }
            }
            if !has_column(db, "settings", "allow_expiry_date").await? || !has_column(db, "food_items", "expiry_date").await? {
                bail!("this database is from a release older than the oldest supported one (settings.allow_expiry_date is missing)");
            }
            if !has("migrations") {
                sqlx::query(
                    "CREATE TABLE `migrations` (`id` int(10) unsigned NOT NULL AUTO_INCREMENT, `migration` varchar(191) NOT NULL, `batch` int(11) NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
                )
                .execute(db)
                .await?;
            }
            record(db, &baseline(), 1).await?;
            report.adopted = true;
        }
    }

    // Pending data migrations
    let ran: Vec<String> = sqlx::query_scalar("SELECT migration FROM migrations").fetch_all(db).await?;
    let batch: i64 = sqlx::query_scalar::<_, Option<i64>>("SELECT MAX(batch) FROM migrations").fetch_one(db).await?.unwrap_or(0) + 1;
    for (name, sql) in MIGRATIONS {
        if ran.iter().any(|r| r == name) {
            continue;
        }
        let mut tx = db.begin().await?;
        sqlx::query(sql).execute(&mut *tx).await.with_context(|| format!("migration {name} failed"))?;
        sqlx::query("INSERT INTO migrations (migration, batch) VALUES (?, ?)").bind(name).bind(batch).execute(&mut *tx).await?;
        tx.commit().await?;
        report.migrated.push(name.to_string());
    }

    ensure_columns(db).await?;
    ensure_indexes(db).await?;

    let settings_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM settings").fetch_one(db).await?;
    if settings_rows == 0 {
        report.admin_password = seed(db, cfg).await?;
        report.seeded = true;
    }
    Ok(report)
}

async fn record(db: &Db, names: &[&str], batch: i64) -> anyhow::Result<()> {
    let ran: Vec<String> = sqlx::query_scalar("SELECT migration FROM migrations").fetch_all(db).await?;
    let mut tx = db.begin().await?;
    for n in names {
        if !ran.iter().any(|r| r == n) {
            sqlx::query("INSERT INTO migrations (migration, batch) VALUES (?, ?)").bind(*n).bind(batch).execute(&mut *tx).await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

/// Minimum data for a new restaurant. Returns the generated admin password
/// when ADMIN_PASSWORD was not set.
async fn seed(db: &Db, cfg: &Config) -> anyhow::Result<Option<String>> {
    tracing::info!("new installation: adding the starting data");
    let now = chrono::Utc::now().naive_utc();
    let mut tx = db.begin().await?;

    let count = |t: &'static str| format!("SELECT COUNT(*) FROM {t}");

    if sqlx::query_scalar::<_, i64>(&count("user_roles")).fetch_one(&mut *tx).await? == 0 {
        let roles: [(&str, bool, &str); 5] = [
            ("Admin", true, "[]"),
            ("Order taker", false, r#"["pos_portal"]"#),
            ("Chef", false, r#"["kitchen_portal"]"#),
            ("Biller", false, r#"["pos_portal","order_checkout"]"#),
            (
                "Manager",
                false,
                r#"["dashboard_access","overall_sale_report","overall_expense_report","tax_report","expense_report","stock_alerts"]"#,
            ),
        ];
        for (name, primary, perms) in roles {
            sqlx::query("INSERT INTO user_roles (name, is_primary, permissions, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
                .bind(name)
                .bind(primary)
                .bind(perms)
                .bind(now)
                .bind(now)
                .execute(&mut *tx)
                .await?;
        }
    }

    let mut generated = None;
    if sqlx::query_scalar::<_, i64>(&count("users")).fetch_one(&mut *tx).await? == 0 {
        let password = match &cfg.admin_password {
            Some(p) => p.clone(),
            None => {
                let p = crate::util::random_string(16);
                generated = Some(p.clone());
                p
            }
        };
        sqlx::query("INSERT INTO users (name, email, password, role_id, status, created_at, updated_at) VALUES (?, ?, ?, 1, 1, ?, ?)")
            .bind(&cfg.admin_name)
            .bind(&cfg.admin_email)
            .bind(hash_password(&password).map_err(|e| anyhow::anyhow!("{e}"))?)
            .bind(now)
            .bind(now)
            .execute(&mut *tx)
            .await?;
    }

    if sqlx::query_scalar::<_, i64>(&count("languages")).fetch_one(&mut *tx).await? == 0 {
        sqlx::query("INSERT INTO languages (locale, name, direction, created_at, updated_at) VALUES ('en', 'English', 'ltr', ?, ?)")
            .bind(now)
            .bind(now)
            .execute(&mut *tx)
            .await?;
    }

    if sqlx::query_scalar::<_, i64>(&count("taxes")).fetch_one(&mut *tx).await? == 0 {
        sqlx::query(
            "INSERT INTO taxes (tax_title, tax_rate, is_vat, is_tax_fix, tax_id, is_tax_included, created_at, updated_at) VALUES ('No tax', 0, 0, 0, '', 0, ?, ?)",
        )
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query(
        "INSERT INTO settings (id, app_name, app_url, app_date_format, app_timezone, currency_symbol, tax_id, tax_title, mail_from_name, created_at, updated_at)
         VALUES (1, 'Restaurant POS', ?, 'd-m-Y H:i', 'UTC', '$', (SELECT COALESCE(MIN(id), 1) FROM taxes), 'No tax', 'Restaurant POS', ?, ?)",
    )
    .bind(&cfg.app_url)
    .bind(now)
    .bind(now)
    .execute(&mut *tx)
    .await?;

    if sqlx::query_scalar::<_, i64>(&count("customers")).fetch_one(&mut *tx).await? == 0 {
        sqlx::query("INSERT INTO customers (uuid, name, created_at, updated_at) VALUES (?, 'Walk-in Customer', ?, ?)")
            .bind(crate::util::uuid())
            .bind(now)
            .bind(now)
            .execute(&mut *tx)
            .await?;
    }

    if sqlx::query_scalar::<_, i64>(&count("payment_methods")).fetch_one(&mut *tx).await? == 0 {
        for m in ["Cash", "Card"] {
            sqlx::query("INSERT INTO payment_methods (title, created_at, updated_at) VALUES (?, ?, ?)")
                .bind(m)
                .bind(now)
                .bind(now)
                .execute(&mut *tx)
                .await?;
        }
    }

    if sqlx::query_scalar::<_, i64>(&count("reservation_statuses")).fetch_one(&mut *tx).await? == 0 {
        for s in ["Reserved", "Not confirmed", "Confirmed", "Cancelled"] {
            sqlx::query("INSERT INTO reservation_statuses (title, created_at, updated_at) VALUES (?, ?, ?)")
                .bind(s)
                .bind(now)
                .bind(now)
                .execute(&mut *tx)
                .await?;
        }
    }

    if sqlx::query_scalar::<_, i64>(&count("booking_sources")).fetch_one(&mut *tx).await? == 0 {
        for s in ["Walk-in", "Phone", "Website"] {
            sqlx::query("INSERT INTO booking_sources (title, created_at, updated_at) VALUES (?, ?, ?)")
                .bind(s)
                .bind(now)
                .bind(now)
                .execute(&mut *tx)
                .await?;
        }
    }

    tx.commit().await?;
    Ok(generated)
}
