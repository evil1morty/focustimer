use tauri::{AppHandle, Listener};
use tauri_plugin_notification::NotificationExt;

use crate::settings::SettingsStore;
use crate::timer::Phase;

fn show(app: &AppHandle, title: &str, body: &str) {
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        eprintln!("notification failed: {e}");
    }
}

fn finished_message(finished: Phase) -> (&'static str, &'static str) {
    match finished {
        Phase::Pomodoro => ("Time for a break", "Step away from the screen."),
        Phase::ShortBreak => ("Back to focus", "Pick the next pomodoro when ready."),
        Phase::LongBreak => ("Long break done", "Fresh round of pomodoros ahead."),
        Phase::Stopped => ("FocusTimer", "Phase finished."),
    }
}

fn about_to_end_message(phase: Phase) -> (&'static str, &'static str) {
    match phase {
        Phase::Pomodoro => ("30 seconds left", "Wrap up your current thought."),
        Phase::ShortBreak | Phase::LongBreak => ("Break ending in 30s", "Get ready to focus."),
        Phase::Stopped => ("30 seconds left", ""),
    }
}

pub(crate) fn wire(app: &AppHandle, settings: SettingsStore) {
    let app_for_finish = app.clone();
    app.listen("timer://phase-finished", move |event| {
        let Ok(finished): Result<Phase, _> = serde_json::from_str(event.payload()) else {
            return;
        };
        let (title, body) = finished_message(finished);
        show(&app_for_finish, title, body);
    });

    let app_for_announce = app.clone();
    let announce_settings = settings.clone();
    app.listen("timer://about-to-end", move |event| {
        if !announce_settings.lock().announce_about_to_end {
            return;
        }
        let Ok(phase): Result<Phase, _> = serde_json::from_str(event.payload()) else {
            return;
        };
        let (title, body) = about_to_end_message(phase);
        show(&app_for_announce, title, body);
    });
}
