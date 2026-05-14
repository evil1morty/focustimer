use chrono::{DateTime, Datelike, Local, NaiveDate, Utc};
use rusqlite::params;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::DbPool;
use crate::error::AppResult;

pub const STATS_CHANGED: &str = "stats://changed";
const ROLLOVER_HOURS: i64 = 4;

#[derive(Debug, Clone, Serialize)]
pub struct DailyEntry {
    pub date: String,
    pub count: u32,
    pub focus_seconds: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct StatsSummary {
    pub today: u32,
    pub today_focus_seconds: i64,
    pub this_week: u32,
    pub all_time: u32,
    pub all_time_focus_seconds: i64,
    pub streak_days: u32,
    pub daily: Vec<DailyEntry>,
}

fn bucket_date(unix_seconds: i64) -> NaiveDate {
    DateTime::<Utc>::from_timestamp(unix_seconds - ROLLOVER_HOURS * 3600, 0)
        .map(|dt| dt.with_timezone(&Local).date_naive())
        .unwrap_or_else(|| Local::now().date_naive())
}

fn today_local() -> NaiveDate {
    bucket_date(Utc::now().timestamp())
}

fn current_task_id(pool: &DbPool) -> Option<i64> {
    pool.lock()
        .query_row(
            "SELECT id FROM tasks
             WHERE is_current = 1 AND completed = 0
             ORDER BY position ASC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .ok()
}

pub fn record_pomodoro(app: &AppHandle, duration_s: u64) {
    let pool = app.state::<DbPool>();
    let finished = Utc::now().timestamp();
    let started = finished - duration_s as i64;
    let task_id = current_task_id(&pool);
    let result = pool.lock().execute(
        "INSERT INTO pomodoros (started_at, finished_at, duration_s, task_id, was_completed)
         VALUES (?, ?, ?, ?, 1)",
        params![started, finished, duration_s as i64, task_id],
    );
    if let Err(e) = result {
        eprintln!("stats: failed to record pomodoro: {e}");
        return;
    }
    let _ = app.emit(STATS_CHANGED, ());
}

#[tauri::command]
pub fn stats_summary(pool: State<DbPool>) -> AppResult<StatsSummary> {
    let conn = pool.lock();

    // Load every finished_at + duration so we can bucket in Rust by local date
    // with a 4 AM rollover. The pomodoros table is small enough for this to be
    // negligible until we accumulate years of data.
    let mut stmt = conn.prepare(
        "SELECT finished_at, duration_s FROM pomodoros
         WHERE was_completed = 1",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?;

    let mut by_date: std::collections::BTreeMap<NaiveDate, (u32, i64)> =
        std::collections::BTreeMap::new();
    let mut all_time: u32 = 0;
    let mut all_time_focus: i64 = 0;
    for row in rows {
        let (finished_at, duration_s) = row?;
        all_time += 1;
        all_time_focus += duration_s;
        let d = bucket_date(finished_at);
        let entry = by_date.entry(d).or_insert((0, 0));
        entry.0 += 1;
        entry.1 += duration_s;
    }

    let today = today_local();
    let monday = today - chrono::Duration::days(today.weekday().num_days_from_monday() as i64);

    let mut today_count = 0u32;
    let mut today_focus = 0i64;
    let mut week_count = 0u32;
    if let Some((c, f)) = by_date.get(&today) {
        today_count = *c;
        today_focus = *f;
    }
    for (d, (c, _)) in by_date.range(monday..=today) {
        if *d >= monday && *d <= today {
            week_count += *c;
        }
    }

    // Last 14 days, filling zeros.
    let mut daily = Vec::with_capacity(14);
    for i in (0..14).rev() {
        let d = today - chrono::Duration::days(i);
        let (count, focus_seconds) = by_date.get(&d).copied().unwrap_or((0, 0));
        daily.push(DailyEntry {
            date: d.format("%Y-%m-%d").to_string(),
            count,
            focus_seconds,
        });
    }

    // Streak: walk back from today while consecutive days have > 0.
    let mut streak = 0u32;
    let mut cursor = today;
    loop {
        let count = by_date.get(&cursor).map(|(c, _)| *c).unwrap_or(0);
        if count == 0 {
            // Today may not have any yet — still count the streak from yesterday.
            if cursor == today {
                cursor -= chrono::Duration::days(1);
                continue;
            }
            break;
        }
        streak += 1;
        cursor -= chrono::Duration::days(1);
    }

    Ok(StatsSummary {
        today: today_count,
        today_focus_seconds: today_focus,
        this_week: week_count,
        all_time,
        all_time_focus_seconds: all_time_focus,
        streak_days: streak,
        daily,
    })
}
