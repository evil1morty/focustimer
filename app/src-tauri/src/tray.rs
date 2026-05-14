use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Listener, Manager, Wry};

use crate::settings::SettingsStore;
use crate::timer::{Phase, TimerEngine, TimerSnapshot};

pub(crate) const TRAY_ID: &str = "main-tray";

fn fmt_ms(ms: u64) -> String {
    let total = (ms / 1000) as u32;
    format!("{:02}:{:02}", total / 60, total % 60)
}

fn phase_label(phase: Phase) -> &'static str {
    match phase {
        Phase::Stopped => "Stopped",
        Phase::Pomodoro => "Focusing",
        Phase::ShortBreak => "Short break",
        Phase::LongBreak => "Long break",
    }
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let show = MenuItem::with_id(app, "show", "Open FocusTimer", true, None::<&str>)?;
    let start = MenuItem::with_id(app, "start_pause", "Start / Pause", true, None::<&str>)?;
    let skip = MenuItem::with_id(app, "skip", "Skip phase", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "Stop & reset", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    Menu::with_items(
        app,
        &[
            &show,
            &PredefinedMenuItem::separator(app)?,
            &start,
            &skip,
            &stop,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn handle_menu(app: &AppHandle, id: &str) {
    match id {
        "show" => show_main(app),
        "start_pause" => {
            let engine = app.state::<TimerEngine>();
            let snap = engine.snapshot();
            if snap.is_running {
                engine.pause();
            } else if snap.is_paused {
                engine.resume();
            } else {
                let next = if snap.phase == Phase::Stopped {
                    Phase::Pomodoro
                } else {
                    snap.phase
                };
                engine.start(Some(next));
            }
        }
        "skip" => {
            app.state::<TimerEngine>().skip(app);
        }
        "stop" => {
            app.state::<TimerEngine>().reset();
        }
        "settings" => {
            show_main(app);
            let _ = app.emit("tray://open-settings", ());
        }
        "quit" => {
            app.exit(0);
        }
        _ => {}
    }
}

pub(crate) fn init(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::Anyhow(anyhow::anyhow!("default window icon missing")))?;

    let app_for_menu = app.clone();
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("FocusTimer")
        .menu(&menu)
        .on_menu_event(move |_, event| {
            handle_menu(&app_for_menu, event.id().as_ref());
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    drop(tray); // managed by the app via TRAY_ID

    // Live tooltip from timer ticks.
    let tooltip_handle = app.clone();
    app.listen("timer://tick", move |event| {
        let Ok(snap): Result<TimerSnapshot, _> = serde_json::from_str(event.payload()) else {
            return;
        };
        let label = phase_label(snap.phase);
        let tip = if snap.phase == Phase::Stopped {
            "FocusTimer — ready".to_string()
        } else {
            format!("FocusTimer — {} · {}", label, fmt_ms(snap.remaining_ms))
        };
        if let Some(tray) = tooltip_handle.tray_by_id(TRAY_ID) {
            let _ = tray.set_tooltip(Some(&tip));
        }
    });

    Ok(())
}

/// Handle the main window's CloseRequested event. When minimize_to_tray is
/// on, hide the window instead of quitting.
pub(crate) fn handle_close(app: &AppHandle, settings: &SettingsStore) -> bool {
    let minimize = settings.lock().minimize_to_tray;
    if !minimize {
        return false;
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    true
}
