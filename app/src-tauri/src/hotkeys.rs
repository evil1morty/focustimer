use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;

use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::settings::{AppSettings, SettingsStore};
use crate::timer::{Phase, TimerEngine};

pub(crate) const HOTKEYS_FAILED: &str = "hotkeys://failed";

#[derive(Debug, Clone, Copy)]
enum Action {
    TogglePause,
    Skip,
    Reset,
}

#[derive(Default, Clone)]
pub struct Bindings {
    map: Arc<Mutex<HashMap<Shortcut, Action>>>,
}

impl Bindings {
    fn replace(&self, m: HashMap<Shortcut, Action>) {
        *self.map.lock() = m;
    }

    fn get(&self, sc: &Shortcut) -> Option<Action> {
        self.map.lock().get(sc).copied()
    }
}

fn parse(s: &str) -> Option<Shortcut> {
    if s.trim().is_empty() {
        return None;
    }
    Shortcut::from_str(s).ok()
}

fn run_action(app: &AppHandle, action: Action) {
    let engine = app.state::<TimerEngine>();
    match action {
        Action::TogglePause => {
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
        Action::Skip => {
            engine.skip(app);
        }
        Action::Reset => {
            engine.reset();
        }
    }
}

pub(crate) fn apply(app: &AppHandle, settings: &AppSettings) {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut next = HashMap::new();
    let mut failures: Vec<String> = Vec::new();

    let want = [
        ("toggle", &settings.hotkey_toggle, Action::TogglePause),
        ("skip", &settings.hotkey_skip, Action::Skip),
        ("reset", &settings.hotkey_reset, Action::Reset),
    ];

    for (name, keys, action) in want {
        let Some(sc) = parse(keys) else {
            failures.push(format!("{name}: unparseable '{keys}'"));
            continue;
        };
        match gs.register(sc) {
            Ok(()) => {
                next.insert(sc, action);
            }
            Err(e) => {
                eprintln!("hotkey: failed to register {name}={keys}: {e}");
                failures.push(format!("{name}: '{keys}' rejected ({e})"));
            }
        }
    }
    app.state::<Bindings>().replace(next);
    // Always emit, even on success (empty list). The frontend uses this to
    // clear any previously-displayed failure banner.
    let _ = app.emit(HOTKEYS_FAILED, &failures);
}

pub(crate) fn plugin(bindings: Bindings) -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(move |app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            if let Some(action) = bindings.get(shortcut) {
                run_action(app, action);
            }
        })
        .build()
}

pub(crate) fn init(app: &AppHandle, settings: &SettingsStore) {
    apply(app, &settings.lock());
}
