mod audio;
mod db;
mod error;
mod hotkeys;
mod notify;
mod settings;
mod stats;
mod tasks;
mod timer;
mod tray;

pub use error::{AppError, AppResult};

use std::sync::Arc;

use parking_lot::Mutex;
use tauri::{Listener, Manager};

use crate::settings::AppSettings;

use crate::audio::AudioController;
use crate::settings::SettingsStore;
use crate::timer::{Phase, TimerSnapshot};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hotkey_bindings = hotkeys::Bindings::default();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(hotkeys::plugin(hotkey_bindings.clone()))
        .manage(hotkey_bindings)
        .setup(|app| {
            let handle = app.handle().clone();
            let pool = db::init(&handle).expect("init sqlite");
            app.manage(pool);
            timer::register(&handle);
            let settings_store = settings::init(&handle);
            app.manage(settings_store.clone());
            let audio = audio::init(&handle);
            app.manage(audio.clone());
            wire_audio_events(&handle, audio, settings_store.clone());
            notify::wire(&handle, settings_store.clone());
            tray::init(&handle)?;
            hotkeys::init(&handle, &settings_store);
            wire_window_close(&handle, settings_store.clone());
            wire_settings_change(&handle, settings_store);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            timer::timer_snapshot,
            timer::timer_start,
            timer::timer_pause,
            timer::timer_resume,
            timer::timer_skip,
            timer::timer_reset,
            timer::timer_set_template,
            timer::timer_set_auto_starts,
            tasks::tasks_list,
            tasks::tasks_create,
            tasks::tasks_update,
            tasks::tasks_delete,
            tasks::tasks_reorder,
            tasks::tasks_set_current,
            settings::settings_get,
            settings::settings_set,
            stats::stats_summary,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn wire_settings_change(app: &tauri::AppHandle, _settings: SettingsStore) {
    let app_handle = app.clone();
    app.listen("settings://changed", move |event| {
        if let Ok(new_settings) = serde_json::from_str::<AppSettings>(event.payload()) {
            hotkeys::apply(&app_handle, &new_settings);
        }
    });
}

fn wire_window_close(app: &tauri::AppHandle, settings: SettingsStore) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let app_handle = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            if tray::handle_close(&app_handle, &settings) {
                api.prevent_close();
            }
        }
    });
}

fn wire_audio_events(app: &tauri::AppHandle, audio: AudioController, settings: SettingsStore) {
    // Alarm on natural phase transitions.
    let alarm_audio = audio.clone();
    let alarm_settings = settings.clone();
    app.listen("timer://phase-finished", move |_event| {
        let s = alarm_settings.lock().clone();
        alarm_audio.play_alarm(&s.alarm_sound, s.alarm_volume);
    });

    // Ticking follows is_running + phase==Pomodoro. We track last known state
    // so we don't restart the sink on every tick (4x/sec).
    let last: Arc<Mutex<Option<(Phase, bool)>>> = Arc::new(Mutex::new(None));
    let tick_audio = audio.clone();
    let tick_settings = settings.clone();
    let tick_last = last.clone();
    app.listen("timer://tick", move |event| {
        let snap: TimerSnapshot = match serde_json::from_str(event.payload()) {
            Ok(s) => s,
            Err(_) => return,
        };
        let want = snap.phase == Phase::Pomodoro && snap.is_running;
        let mut prev = tick_last.lock();
        let is_ticking = matches!(*prev, Some((Phase::Pomodoro, true)));
        if want != is_ticking {
            let s = tick_settings.lock().clone();
            if want {
                tick_audio.start_ticking(&s.ticking_sound, s.ticking_volume);
            } else {
                tick_audio.stop_ticking();
            }
        }
        *prev = Some((snap.phase, snap.is_running));
    });
}
