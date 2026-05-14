use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::AppResult;
use crate::timer::{SessionTemplate, TimerEngine};

pub(crate) const SETTINGS_CHANGED: &str = "settings://changed";

fn default_pomodoro_min() -> u32 {
    25
}
fn default_short_break_min() -> u32 {
    5
}
fn default_long_break_min() -> u32 {
    15
}
fn default_cycles() -> u32 {
    4
}
fn default_volume() -> f32 {
    0.8
}
fn default_alarm_sound() -> String {
    "bell".into()
}
fn default_ticking_sound() -> String {
    "off".into()
}
fn default_theme() -> String {
    "system".into()
}
fn default_hotkey_toggle() -> String {
    "Ctrl+Alt+P".into()
}
fn default_hotkey_skip() -> String {
    "Ctrl+Alt+S".into()
}
fn default_hotkey_reset() -> String {
    "Ctrl+Alt+R".into()
}
fn default_true() -> bool {
    true
}
fn default_false() -> bool {
    false
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(default = "default_pomodoro_min")]
    pub pomodoro_min: u32,
    #[serde(default = "default_short_break_min")]
    pub short_break_min: u32,
    #[serde(default = "default_long_break_min")]
    pub long_break_min: u32,
    #[serde(default = "default_cycles")]
    pub cycles_per_long_break: u32,

    #[serde(default = "default_true")]
    pub auto_start_breaks: bool,
    #[serde(default = "default_false")]
    pub auto_start_pomodoros: bool,

    #[serde(default = "default_alarm_sound")]
    pub alarm_sound: String,
    #[serde(default = "default_volume")]
    pub alarm_volume: f32,
    #[serde(default = "default_ticking_sound")]
    pub ticking_sound: String,
    #[serde(default = "default_volume")]
    pub ticking_volume: f32,

    #[serde(default = "default_true")]
    pub announce_about_to_end: bool,

    #[serde(default = "default_theme")]
    pub theme: String,

    #[serde(default = "default_false")]
    pub autostart: bool,
    #[serde(default = "default_true")]
    pub minimize_to_tray: bool,
    #[serde(default = "default_true")]
    pub pause_on_lock: bool,

    #[serde(default = "default_hotkey_toggle")]
    pub hotkey_toggle: String,
    #[serde(default = "default_hotkey_skip")]
    pub hotkey_skip: String,
    #[serde(default = "default_hotkey_reset")]
    pub hotkey_reset: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        // Hand-rolled instead of `serde_json::from_str("{}").unwrap()` so
        // adding a new field without a #[serde(default)] is a compile error
        // rather than a runtime panic on first launch.
        Self {
            pomodoro_min: default_pomodoro_min(),
            short_break_min: default_short_break_min(),
            long_break_min: default_long_break_min(),
            cycles_per_long_break: default_cycles(),
            auto_start_breaks: default_true(),
            auto_start_pomodoros: default_false(),
            alarm_sound: default_alarm_sound(),
            alarm_volume: default_volume(),
            ticking_sound: default_ticking_sound(),
            ticking_volume: default_volume(),
            announce_about_to_end: default_true(),
            theme: default_theme(),
            autostart: default_false(),
            minimize_to_tray: default_true(),
            pause_on_lock: default_true(),
            hotkey_toggle: default_hotkey_toggle(),
            hotkey_skip: default_hotkey_skip(),
            hotkey_reset: default_hotkey_reset(),
        }
    }
}

impl AppSettings {
    pub fn session_template(&self) -> SessionTemplate {
        SessionTemplate {
            pomodoro_ms: self.pomodoro_min as u64 * 60_000,
            short_break_ms: self.short_break_min as u64 * 60_000,
            long_break_ms: self.long_break_min as u64 * 60_000,
            cycles_per_long_break: self.cycles_per_long_break.max(1),
        }
    }
}

pub type SettingsStore = Arc<Mutex<AppSettings>>;

fn settings_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .context("resolving app_data_dir")?;
    Ok(dir.join("settings.json"))
}

fn load_from_disk(app: &AppHandle) -> AppSettings {
    let Ok(path) = settings_path(app) else {
        return AppSettings::default();
    };
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => AppSettings::default(),
    }
}

fn save_to_disk(app: &AppHandle, settings: &AppSettings) -> Result<()> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let json = serde_json::to_string_pretty(settings)?;
    std::fs::write(path, json)?;
    Ok(())
}

fn apply_to_timer(settings: &AppSettings, engine: &TimerEngine) {
    engine.set_template(settings.session_template());
    engine.set_auto_starts(settings.auto_start_breaks, settings.auto_start_pomodoros);
}

pub(crate) fn init(app: &AppHandle) -> SettingsStore {
    let settings = load_from_disk(app);
    if let Some(engine) = app.try_state::<TimerEngine>() {
        apply_to_timer(&settings, &engine);
    }
    Arc::new(Mutex::new(settings))
}

#[tauri::command]
pub fn settings_get(store: State<SettingsStore>) -> AppSettings {
    store.lock().clone()
}

#[tauri::command]
pub fn settings_set(
    app: AppHandle,
    store: State<SettingsStore>,
    engine: State<TimerEngine>,
    settings: AppSettings,
) -> AppResult<AppSettings> {
    {
        let mut guard = store.lock();
        *guard = settings.clone();
    }
    save_to_disk(&app, &settings)?;
    apply_to_timer(&settings, &engine);
    let _ = app.emit(SETTINGS_CHANGED, &settings);
    Ok(settings)
}
