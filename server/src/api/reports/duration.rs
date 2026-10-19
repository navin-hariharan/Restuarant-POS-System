//! Report date ranges ("today", "this week", "last quarter", custom...),
//! evaluated on the restaurant's wall clock like the stored timestamps.

use crate::{input::Input, query::Sql};
use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use regex::Regex;
use std::sync::LazyLock;

/// A condition on a timestamp column.
#[derive(Debug, Clone, PartialEq)]
pub enum Range {
    All,
    Between(NaiveDateTime, NaiveDateTime),
    Date(NaiveDate),
    Month(i32, u32),
    Year(i32),
}

impl Range {
    /// Append " AND <condition on col>" (col comes from code, never input).
    pub fn apply(&self, sql: &mut Sql, col: &str) {
        match self {
            Range::All => {}
            Range::Between(a, b) => {
                sql.push_args(&format!(" AND {col} BETWEEN ? AND ?"), [*a, *b]);
            }
            Range::Date(d) => {
                sql.push_args(&format!(" AND DATE({col}) = ?"), [*d]);
            }
            Range::Month(y, m) => {
                sql.push_args(&format!(" AND YEAR({col}) = ? AND MONTH({col}) = ?"), [*y as i64, *m as i64]);
            }
            Range::Year(y) => {
                sql.push_args(&format!(" AND YEAR({col}) = ?"), [*y as i64]);
            }
        }
    }
}

fn start_of_day(d: NaiveDate) -> NaiveDateTime {
    d.and_time(NaiveTime::MIN)
}

fn end_of_day(d: NaiveDate) -> NaiveDateTime {
    d.and_hms_opt(23, 59, 59).unwrap_or_else(|| start_of_day(d))
}

fn first_of_month(y: i32, m: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, 1).unwrap_or(NaiveDate::MIN)
}

/// (year, month) shifted by `n` months.
fn shift_month(y: i32, m: u32, n: i32) -> (i32, u32) {
    let idx = y * 12 + m as i32 - 1 + n;
    (idx.div_euclid(12), (idx.rem_euclid(12) + 1) as u32)
}

fn days_in_month(y: i32, m: u32) -> u32 {
    let (ny, nm) = shift_month(y, m, 1);
    first_of_month(ny, nm).pred_opt().map(|d| d.day()).unwrap_or(28)
}

/// Same time `n` months away; the day is clamped to the target month
/// (31 March minus one month is 28/29 February, not early March).
pub fn add_months(dt: NaiveDateTime, n: i32) -> NaiveDateTime {
    let (y, m) = shift_month(dt.year(), dt.month(), n);
    let day = dt.day().min(days_in_month(y, m));
    NaiveDate::from_ymd_opt(y, m, day).map(|d| d.and_time(dt.time())).unwrap_or(dt)
}

/// Monday of the week containing `d` (weeks start on Monday).
fn monday(d: NaiveDate) -> NaiveDate {
    d - Duration::days(d.weekday().num_days_from_monday() as i64)
}

/// "H:i" / "H:i:s" as given, anything else the default.
fn normalize_time(t: Option<&str>, default: &str) -> String {
    static HM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{2}:\d{2}$").expect("regex"));
    static HMS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{2}:\d{2}:\d{2}$").expect("regex"));
    match t {
        Some(t) if HM.is_match(t) => format!("{t}:00"),
        Some(t) if HMS.is_match(t) => t.to_string(),
        _ => default.to_string(),
    }
}

/// "Y-m-d H:i:s" parsed leniently like PHP: out-of-range parts roll over
/// (2026-02-30 is 2 March). None when the text does not have that shape.
pub fn parse_lenient(s: &str) -> Option<NaiveDateTime> {
    static RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^(\d{1,4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{2}):(\d{2})$").expect("regex"));
    let c = RE.captures(s)?;
    let n = |i: usize| c.get(i).and_then(|m| m.as_str().parse::<i64>().ok()).unwrap_or(0);
    let (y, m) = shift_month(n(1) as i32, 1, n(2) as i32 - 1);
    let base = start_of_day(first_of_month(y, m));
    base.checked_add_signed(Duration::days(n(3) - 1) + Duration::hours(n(4)) + Duration::minutes(n(5)) + Duration::seconds(n(6)))
}

/// PHP truthiness of an optional request string ("" and "0" are false).
fn given(v: &Option<String>) -> bool {
    matches!(v.as_deref(), Some(s) if !s.is_empty() && s != "0")
}

/// Range for `duration` + `starting_date/time` + `ending_date/time`.
pub fn advance(input: &Input, now: NaiveDateTime, tz: Tz) -> Range {
    let interval = input.str("duration");
    let start_date = input.str("starting_date");
    let end_date = input.str("ending_date");
    let start_time = normalize_time(input.str("starting_time").as_deref(), "00:00:00");
    let end_time = normalize_time(input.str("ending_time").as_deref(), "23:59:59");
    let epoch = Utc.timestamp_opt(0, 0).single().map(|d| d.with_timezone(&tz).naive_local()).unwrap_or_default();

    let start = if given(&start_date) { parse_lenient(&format!("{} {start_time}", start_date.as_deref().unwrap_or(""))) } else { Some(epoch) };
    let end = if given(&end_date) { parse_lenient(&format!("{} {end_time}", end_date.as_deref().unwrap_or(""))) } else { Some(now) };
    // an unreadable date resets both ends
    let (start, end) = match (start, end) {
        (Some(a), Some(b)) => (a, b),
        _ => (epoch, now),
    };
    let anchor = if given(&start_date) { start } else { now };
    let today = now.date();

    match interval.as_deref().unwrap_or("") {
        "today" => Range::Between(start_of_day(today), end_of_day(today)),
        "yesterday" => Range::Date(today - Duration::days(1)),
        "weekly" => {
            let mon = monday(anchor.date());
            Range::Between(start_of_day(mon), end_of_day(mon + Duration::days(6)))
        }
        "monthly" => Range::Month(anchor.year(), anchor.month()),
        "last_month" => {
            let (y, m) = shift_month(today.year(), today.month(), -1);
            Range::Month(y, m)
        }
        "yearly" => Range::Year(anchor.year()),
        "last_three_months" => {
            let (y, m) = shift_month(today.year(), today.month(), -3);
            Range::Between(start_of_day(first_of_month(y, m)), end)
        }
        "last_year" => Range::Year(today.year() - 1),
        "last_seven_days" => Range::Between(now - Duration::days(7), now),
        "last_six_months" => Range::Between(add_months(now, -6), now),
        "last_quarter" => {
            let q_start = (today.month() - 1) / 3 * 3 + 1;
            let (y, m) = shift_month(today.year(), q_start, -3);
            let (ey, em) = shift_month(y, m, 2);
            Range::Between(start_of_day(first_of_month(y, m)), end_of_day(NaiveDate::from_ymd_opt(ey, em, days_in_month(ey, em)).unwrap_or(today)))
        }
        "last_biannual" => {
            let (y, m) = shift_month(today.year(), 1, -6);
            Range::Between(start_of_day(first_of_month(y, m)), now)
        }
        "last_biweek" => Range::Between(now - Duration::weeks(2), now),
        "last_work_week" => {
            // the most recent Monday-Friday that has ended before today
            let mut friday = today - Duration::days(1);
            while friday.weekday() != chrono::Weekday::Fri {
                friday -= Duration::days(1);
            }
            Range::Between(start_of_day(friday - Duration::days(4)), end_of_day(friday))
        }
        "custom" => Range::Between(start, end),
        _ => Range::All,
    }
}

/// Dashboard periods: "day", "month" or "year" (the current one, or the one
/// before when `last`), anything else = all time.
pub fn simple(value: Option<&str>, last: bool, now: NaiveDateTime) -> Range {
    let date = match (last, value) {
        (true, Some("year")) => add_months(now, -12),
        (true, Some("month")) => add_months(now, -1),
        (true, Some("day")) => now - Duration::days(1),
        _ => now,
    };
    match value {
        Some("day") => Range::Date(date.date()),
        Some("month") => Range::Month(date.year(), date.month()),
        Some("year") => Range::Year(date.year()),
        _ => Range::All,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").unwrap()
    }

    #[test]
    fn lenient_dates_roll_over() {
        assert_eq!(parse_lenient("2026-02-30 00:00:00"), Some(dt("2026-03-02 00:00:00")));
        assert_eq!(parse_lenient("2026-13-01 00:00:00"), Some(dt("2027-01-01 00:00:00")));
        assert_eq!(parse_lenient("2026-00-00 00:00:00"), Some(dt("2025-11-30 00:00:00")));
        assert_eq!(parse_lenient("2026-1-5 05:07:00"), Some(dt("2026-01-05 05:07:00")));
        assert_eq!(parse_lenient("2026-01-01 24:60:60"), Some(dt("2026-01-02 01:01:00")));
        assert_eq!(parse_lenient("2026/01/01 00:00:00"), None);
        assert_eq!(parse_lenient("20261-01-01 00:00:00"), None);
    }

    #[test]
    fn months_do_not_overflow() {
        assert_eq!(add_months(dt("2026-03-31 10:00:00"), -1), dt("2026-02-28 10:00:00"));
        assert_eq!(add_months(dt("2028-02-29 10:00:00"), -12), dt("2027-02-28 10:00:00"));
        assert_eq!(add_months(dt("2026-01-15 00:00:00"), -3), dt("2025-10-15 00:00:00"));
    }

    #[test]
    fn simple_periods() {
        let now = dt("2026-03-31 10:00:00");
        assert_eq!(simple(Some("month"), true, now), Range::Month(2026, 2));
        assert_eq!(simple(Some("day"), true, now), Range::Date(NaiveDate::from_ymd_opt(2026, 3, 30).unwrap()));
        assert_eq!(simple(Some("year"), false, now), Range::Year(2026));
        assert_eq!(simple(None, false, now), Range::All);
    }

    #[test]
    fn helpers() {
        assert_eq!(normalize_time(Some("10:30"), "x"), "10:30:00");
        assert_eq!(normalize_time(Some("1:30"), "00:00:00"), "00:00:00");
        assert_eq!(monday(NaiveDate::from_ymd_opt(2026, 10, 18).unwrap()), NaiveDate::from_ymd_opt(2026, 10, 12).unwrap());
        assert_eq!(shift_month(2026, 1, -1), (2025, 12));
    }
}
