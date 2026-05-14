use std::path::Path;
use std::sync::Arc;

use anyhow::{Context, Result};
use parking_lot::Mutex;
use rusqlite::Connection;
use tauri::{AppHandle, Manager};

pub type DbPool = Arc<Mutex<Connection>>;

fn ensure_dir(path: &Path) -> Result<()> {
    if !path.exists() {
        std::fs::create_dir_all(path)
            .with_context(|| format!("creating dir {}", path.display()))?;
    }
    Ok(())
}

pub(crate) fn init(app: &AppHandle) -> Result<DbPool> {
    let data_dir = app
        .path()
        .app_data_dir()
        .context("resolving app_data_dir")?;
    ensure_dir(&data_dir)?;
    let db_path = data_dir.join("focustimer.db");

    let conn = Connection::open(&db_path)
        .with_context(|| format!("opening sqlite at {}", db_path.display()))?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;",
    )?;
    apply_migrations(&conn)?;
    Ok(Arc::new(Mutex::new(conn)))
}

fn apply_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            est_pomodoros INTEGER NOT NULL DEFAULT 1,
            done_pomodoros INTEGER NOT NULL DEFAULT 0,
            completed INTEGER NOT NULL DEFAULT 0,
            position INTEGER NOT NULL,
            is_current INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_tasks_position ON tasks(position);

         CREATE TABLE IF NOT EXISTS pomodoros (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at INTEGER NOT NULL,
            finished_at INTEGER NOT NULL,
            duration_s INTEGER NOT NULL,
            task_id INTEGER,
            was_completed INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
         );
         CREATE INDEX IF NOT EXISTS idx_pomodoros_finished_at ON pomodoros(finished_at);",
    )?;
    Ok(())
}
