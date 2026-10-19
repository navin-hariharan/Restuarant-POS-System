//! API routes, served under /api/v1. Each module owns its own paths.

use crate::state::AppState;
use axum::Router;

pub mod account;
pub mod activity_logs;
pub mod auth;
pub mod backups;
pub mod cashbooks;
pub mod customers;
pub mod dashboard;
pub mod digital_menu;
pub mod expense_types;
pub mod expenses;
pub mod food_categories;
pub mod food_items;
pub mod import_export;
pub mod ingredients;
pub mod languages;
pub mod locale;
pub mod media;
pub mod modifiers;
pub mod payment_methods;
pub mod pickup_points;
pub mod pos;
pub mod print;
pub mod records;
pub mod reports;
pub mod roles;
pub mod rooms;
pub mod sales;
pub mod service_tables;
pub mod settings;
pub mod system;
pub mod taxes;
pub mod users;

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(system::router())
        .merge(auth::router())
        .merge(account::router())
        .merge(users::router())
        .merge(roles::router())
        .merge(locale::router())
        .merge(languages::router())
        .merge(media::router())
        .merge(activity_logs::router())
        .merge(food_categories::router())
        .merge(food_items::router())
        .merge(modifiers::router())
        .merge(ingredients::router())
        .merge(taxes::router())
        .merge(payment_methods::router())
        .merge(pickup_points::router())
        .merge(service_tables::router())
        .merge(expense_types::router())
        .merge(expenses::router())
        .merge(customers::router())
        .merge(pos::router())
        .merge(sales::router())
        .merge(digital_menu::router())
        .merge(print::router())
        .merge(cashbooks::router())
        .merge(reports::router())
        .merge(dashboard::router())
        .merge(import_export::router())
        .merge(settings::router())
        .merge(backups::router())
        .merge(rooms::router())
}
