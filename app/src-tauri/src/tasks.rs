use chrono::Utc;
use rusqlite::{params, Row};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::DbPool;
use crate::error::{AppError, AppResult};

pub(crate) const TASKS_CHANGED: &str = "tasks://changed";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub est_pomodoros: u32,
    pub done_pomodoros: u32,
    pub completed: bool,
    pub position: i64,
    pub is_current: bool,
    pub created_at: i64,
}

fn row_to_task(row: &Row<'_>) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get("id")?,
        title: row.get("title")?,
        est_pomodoros: row.get::<_, i64>("est_pomodoros")? as u32,
        done_pomodoros: row.get::<_, i64>("done_pomodoros")? as u32,
        completed: row.get::<_, i64>("completed")? != 0,
        position: row.get("position")?,
        is_current: row.get::<_, i64>("is_current")? != 0,
        created_at: row.get("created_at")?,
    })
}

fn list_all(pool: &DbPool) -> AppResult<Vec<Task>> {
    let conn = pool.lock();
    let mut stmt = conn.prepare(
        "SELECT id, title, est_pomodoros, done_pomodoros, completed, position,
                is_current, created_at
         FROM tasks
         ORDER BY position ASC, id ASC",
    )?;
    let rows = stmt.query_map([], row_to_task)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn emit_changed(app: &AppHandle, pool: &DbPool) {
    if let Ok(tasks) = list_all(pool) {
        let _ = app.emit(TASKS_CHANGED, &tasks);
    }
}

#[tauri::command]
pub fn tasks_list(pool: State<DbPool>) -> AppResult<Vec<Task>> {
    list_all(&pool)
}

#[tauri::command]
pub fn tasks_create(
    app: AppHandle,
    pool: State<DbPool>,
    title: String,
    est_pomodoros: Option<u32>,
) -> AppResult<Task> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Validation("task title is empty".into()));
    }
    let est = est_pomodoros.unwrap_or(1).max(1);
    let now = Utc::now().timestamp();
    let id = {
        let conn = pool.lock();
        let next_pos: i64 = conn.query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM tasks",
            [],
            |r| r.get(0),
        )?;
        conn.execute(
            "INSERT INTO tasks (title, est_pomodoros, done_pomodoros, completed,
                                position, is_current, created_at)
             VALUES (?, ?, 0, 0, ?, 0, ?)",
            params![title, est as i64, next_pos, now],
        )?;
        conn.last_insert_rowid()
    };
    make_current_if_none(&pool, id)?;
    emit_changed(&app, &pool);
    let conn = pool.lock();
    let task = conn.query_row(
        "SELECT id, title, est_pomodoros, done_pomodoros, completed, position,
                is_current, created_at FROM tasks WHERE id = ?",
        params![id],
        row_to_task,
    )?;
    Ok(task)
}

#[derive(Deserialize)]
pub struct TaskPatch {
    pub title: Option<String>,
    pub est_pomodoros: Option<u32>,
    pub completed: Option<bool>,
}

#[tauri::command]
pub fn tasks_update(
    app: AppHandle,
    pool: State<DbPool>,
    id: i64,
    patch: TaskPatch,
) -> AppResult<()> {
    {
        let conn = pool.lock();
        if let Some(title) = patch.title {
            let title = title.trim().to_string();
            if title.is_empty() {
                return Err(AppError::Validation("task title is empty".into()));
            }
            conn.execute(
                "UPDATE tasks SET title = ? WHERE id = ?",
                params![title, id],
            )?;
        }
        if let Some(est) = patch.est_pomodoros {
            let est = est.max(1) as i64;
            conn.execute(
                "UPDATE tasks SET est_pomodoros = ? WHERE id = ?",
                params![est, id],
            )?;
        }
        if let Some(completed) = patch.completed {
            conn.execute(
                "UPDATE tasks SET completed = ? WHERE id = ?",
                params![completed as i64, id],
            )?;
        }
    }
    emit_changed(&app, &pool);
    Ok(())
}

#[tauri::command]
pub fn tasks_delete(app: AppHandle, pool: State<DbPool>, id: i64) -> AppResult<()> {
    {
        let conn = pool.lock();
        conn.execute("DELETE FROM tasks WHERE id = ?", params![id])?;
    }
    emit_changed(&app, &pool);
    Ok(())
}

#[tauri::command]
pub fn tasks_reorder(app: AppHandle, pool: State<DbPool>, ordered_ids: Vec<i64>) -> AppResult<()> {
    {
        let mut conn = pool.lock();
        let tx = conn.transaction()?;
        for (i, id) in ordered_ids.iter().enumerate() {
            tx.execute(
                "UPDATE tasks SET position = ? WHERE id = ?",
                params![i as i64, id],
            )?;
        }
        tx.commit()?;
    }
    emit_changed(&app, &pool);
    Ok(())
}

#[tauri::command]
pub fn tasks_set_current(app: AppHandle, pool: State<DbPool>, id: Option<i64>) -> AppResult<()> {
    {
        let conn = pool.lock();
        conn.execute("UPDATE tasks SET is_current = 0", [])?;
        if let Some(id) = id {
            conn.execute("UPDATE tasks SET is_current = 1 WHERE id = ?", params![id])?;
        }
    }
    emit_changed(&app, &pool);
    Ok(())
}

fn make_current_if_none(pool: &DbPool, id: i64) -> AppResult<()> {
    let conn = pool.lock();
    let has_current: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tasks WHERE is_current = 1 AND completed = 0",
        [],
        |r| r.get(0),
    )?;
    if has_current == 0 {
        conn.execute("UPDATE tasks SET is_current = 1 WHERE id = ?", params![id])?;
    }
    Ok(())
}

/// Increment the active task's done counter. Called by the timer when a
/// pomodoro completes naturally. Returns the (id, done) of the affected task.
pub(crate) fn increment_current(app: &AppHandle) -> Option<(i64, u32)> {
    let pool = app.state::<DbPool>();
    let result = {
        let conn = pool.lock();
        let current_id: Option<i64> = conn
            .query_row(
                "SELECT id FROM tasks
                 WHERE is_current = 1 AND completed = 0
                 ORDER BY position ASC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .ok();
        let id = current_id?;
        conn.execute(
            "UPDATE tasks SET done_pomodoros = done_pomodoros + 1 WHERE id = ?",
            params![id],
        )
        .ok()?;
        conn.execute(
            "UPDATE tasks SET completed = 1
             WHERE id = ? AND done_pomodoros >= est_pomodoros",
            params![id],
        )
        .ok()?;
        let done: i64 = conn
            .query_row(
                "SELECT done_pomodoros FROM tasks WHERE id = ?",
                params![id],
                |r| r.get(0),
            )
            .ok()?;
        Some((id, done as u32))
    };
    {
        let conn = pool.lock();
        let still_current: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE is_current = 1 AND completed = 0",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if still_current == 0 {
            let _ = conn.execute("UPDATE tasks SET is_current = 0", []);
            let next_id: Option<i64> = conn
                .query_row(
                    "SELECT id FROM tasks WHERE completed = 0
                     ORDER BY position ASC LIMIT 1",
                    [],
                    |r| r.get(0),
                )
                .ok();
            if let Some(nid) = next_id {
                let _ = conn.execute("UPDATE tasks SET is_current = 1 WHERE id = ?", params![nid]);
            }
        }
    }
    if let Ok(tasks) = list_all(&pool) {
        let _ = app.emit(TASKS_CHANGED, &tasks);
    }
    result
}
