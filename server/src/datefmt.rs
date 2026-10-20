//! Date formatting with PHP `date()` format strings, because the date format
//! saved in Settings (e.g. "d-m-Y" or "Y-m-d, h:i A") uses that syntax.

use chrono::{Datelike, NaiveDateTime, Timelike, Weekday};

pub fn php_format(dt: &NaiveDateTime, fmt: &str) -> String {
    let mut out = String::with_capacity(fmt.len() * 2);
    let mut chars = fmt.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                if let Some(n) = chars.next() {
                    out.push(n);
                }
            }
            // Day
            'd' => out.push_str(&format!("{:02}", dt.day())),
            'D' => out.push_str(short_day(dt.weekday())),
            'j' => out.push_str(&dt.day().to_string()),
            'l' => out.push_str(long_day(dt.weekday())),
            'N' => out.push_str(&dt.weekday().number_from_monday().to_string()),
            'S' => out.push_str(suffix(dt.day())),
            'w' => out.push_str(&dt.weekday().num_days_from_sunday().to_string()),
            'z' => out.push_str(&dt.ordinal0().to_string()),
            // Week / month / year
            'W' => out.push_str(&format!("{:02}", dt.iso_week().week())),
            'F' => out.push_str(long_month(dt.month())),
            'm' => out.push_str(&format!("{:02}", dt.month())),
            'M' => out.push_str(&long_month(dt.month())[..3]),
            'n' => out.push_str(&dt.month().to_string()),
            't' => out.push_str(&days_in_month(dt.year(), dt.month()).to_string()),
            'L' => out.push_str(if is_leap(dt.year()) { "1" } else { "0" }),
            'o' => out.push_str(&dt.iso_week().year().to_string()),
            'Y' => out.push_str(&dt.year().to_string()),
            'y' => out.push_str(&format!("{:02}", dt.year().rem_euclid(100))),
            // Time
            'a' => out.push_str(if dt.hour() < 12 { "am" } else { "pm" }),
            'A' => out.push_str(if dt.hour() < 12 { "AM" } else { "PM" }),
            'g' => out.push_str(&hour12(dt.hour()).to_string()),
            'G' => out.push_str(&dt.hour().to_string()),
            'h' => out.push_str(&format!("{:02}", hour12(dt.hour()))),
            'H' => out.push_str(&format!("{:02}", dt.hour())),
            'i' => out.push_str(&format!("{:02}", dt.minute())),
            's' => out.push_str(&format!("{:02}", dt.second())),
            'u' => out.push_str("000000"),
            'v' => out.push_str("000"),
            'U' => out.push_str(&dt.and_utc().timestamp().to_string()),
            'c' => out.push_str(&dt.format("%Y-%m-%dT%H:%M:%S+00:00").to_string()),
            'r' => out.push_str(&dt.format("%a, %d %b %Y %H:%M:%S +0000").to_string()),
            'e' | 'T' => out.push_str("UTC"),
            'P' => out.push_str("+00:00"),
            'O' => out.push_str("+0000"),
            'Z' | 'I' => out.push('0'),
            other => out.push(other),
        }
    }
    out
}

fn hour12(h: u32) -> u32 {
    match h % 12 {
        0 => 12,
        x => x,
    }
}

fn suffix(day: u32) -> &'static str {
    match (day % 10, day % 100) {
        (_, 11..=13) => "th",
        (1, _) => "st",
        (2, _) => "nd",
        (3, _) => "rd",
        _ => "th",
    }
}

fn is_leap(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: i32, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ if is_leap(y) => 29,
        _ => 28,
    }
}

fn short_day(d: Weekday) -> &'static str {
    &long_day(d)[..3]
}

fn long_day(d: Weekday) -> &'static str {
    match d {
        Weekday::Mon => "Monday",
        Weekday::Tue => "Tuesday",
        Weekday::Wed => "Wednesday",
        Weekday::Thu => "Thursday",
        Weekday::Fri => "Friday",
        Weekday::Sat => "Saturday",
        Weekday::Sun => "Sunday",
    }
}

fn long_month(m: u32) -> &'static str {
    ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
        [(m.clamp(1, 12) - 1) as usize]
}

/// Parse "Y-m-d H:i:s" / "Y-m-d" / ISO strings coming from the database or input.
pub fn parse(s: &str) -> Option<NaiveDateTime> {
    let s = s.trim();
    for f in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M"] {
        if let Ok(d) = NaiveDateTime::parse_from_str(s.trim_end_matches('Z'), f) {
            return Some(d);
        }
    }
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok().and_then(|d| d.and_hms_opt(0, 0, 0))
}

/// "2024-10-23T00:13:38.000000Z", the timestamp format of whole records in JSON.
pub fn iso(dt: &NaiveDateTime) -> String {
    dt.format("%Y-%m-%dT%H:%M:%S.000000Z").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dt() -> NaiveDateTime {
        parse("2024-03-05 14:07:09").unwrap()
    }

    #[test]
    fn formats() {
        assert_eq!(php_format(&dt(), "d-m-Y"), "05-03-2024");
        assert_eq!(php_format(&dt(), "Y-m-d, h:s:i"), "2024-03-05, 02:09:07");
        assert_eq!(php_format(&dt(), "D, jS M Y g:i A"), "Tue, 5th Mar 2024 2:07 PM");
        assert_eq!(php_format(&dt(), "\\D\\a\\y d"), "Day 05");
    }
}
