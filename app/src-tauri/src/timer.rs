use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::time;

pub(crate) const TICK_EVENT: &str = "timer://tick";
const TICK_INTERVAL_MS: u64 = 250;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Stopped,
    Pomodoro,
    ShortBreak,
    LongBreak,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SessionTemplate {
    pub pomodoro_ms: u64,
    pub short_break_ms: u64,
    pub long_break_ms: u64,
    pub cycles_per_long_break: u32,
}

impl Default for SessionTemplate {
    fn default() -> Self {
        Self {
            pomodoro_ms: 25 * 60 * 1000,
            short_break_ms: 5 * 60 * 1000,
            long_break_ms: 15 * 60 * 1000,
            cycles_per_long_break: 4,
        }
    }
}

impl SessionTemplate {
    fn duration_for(&self, phase: Phase) -> u64 {
        match phase {
            Phase::Pomodoro => self.pomodoro_ms,
            Phase::ShortBreak => self.short_break_ms,
            Phase::LongBreak => self.long_break_ms,
            Phase::Stopped => 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimerSnapshot {
    pub phase: Phase,
    pub elapsed_ms: u64,
    pub total_ms: u64,
    pub remaining_ms: u64,
    pub is_running: bool,
    pub is_paused: bool,
    pub completed_pomodoros: u32,
    pub cycles_per_long_break: u32,
    pub template: SessionTemplate,
}

#[derive(Debug)]
struct Inner {
    template: SessionTemplate,
    phase: Phase,
    started_at: Option<Instant>,
    paused_at: Option<Instant>,
    completed_pomodoros: u32,
    auto_start_breaks: bool,
    auto_start_pomodoros: bool,
    announced_about_to_end: bool,
}

impl Inner {
    fn new() -> Self {
        Self {
            template: SessionTemplate::default(),
            phase: Phase::Stopped,
            started_at: None,
            paused_at: None,
            completed_pomodoros: 0,
            auto_start_breaks: true,
            auto_start_pomodoros: false,
            announced_about_to_end: false,
        }
    }

    fn auto_start_for(&self, next: Phase) -> bool {
        match next {
            Phase::Pomodoro => self.auto_start_pomodoros,
            Phase::ShortBreak | Phase::LongBreak => self.auto_start_breaks,
            Phase::Stopped => false,
        }
    }

    fn elapsed_ms(&self) -> u64 {
        let Some(started) = self.started_at else {
            return 0;
        };
        let now_ref = self.paused_at.unwrap_or_else(Instant::now);
        now_ref.saturating_duration_since(started).as_millis() as u64
    }

    fn total_ms(&self) -> u64 {
        self.template.duration_for(self.phase)
    }

    fn is_running(&self) -> bool {
        self.started_at.is_some() && self.paused_at.is_none() && self.phase != Phase::Stopped
    }

    fn is_paused(&self) -> bool {
        self.paused_at.is_some()
    }

    fn snapshot(&self) -> TimerSnapshot {
        let elapsed = self.elapsed_ms();
        let total = self.total_ms();
        TimerSnapshot {
            phase: self.phase,
            elapsed_ms: elapsed,
            total_ms: total,
            remaining_ms: total.saturating_sub(elapsed),
            is_running: self.is_running(),
            is_paused: self.is_paused(),
            completed_pomodoros: self.completed_pomodoros,
            cycles_per_long_break: self.template.cycles_per_long_break,
            template: self.template,
        }
    }

    fn next_phase_after(&self, finished: Phase) -> Phase {
        match finished {
            Phase::Pomodoro => {
                let completed = self.completed_pomodoros.saturating_add(1);
                if self.template.cycles_per_long_break > 0
                    && completed.is_multiple_of(self.template.cycles_per_long_break)
                {
                    Phase::LongBreak
                } else {
                    Phase::ShortBreak
                }
            }
            Phase::ShortBreak | Phase::LongBreak => Phase::Pomodoro,
            Phase::Stopped => Phase::Pomodoro,
        }
    }

    fn begin_phase(&mut self, phase: Phase, autostart: bool) {
        self.phase = phase;
        self.paused_at = None;
        self.announced_about_to_end = false;
        if autostart && phase != Phase::Stopped {
            self.started_at = Some(Instant::now());
        } else {
            self.started_at = None;
        }
    }
}

#[derive(Clone)]
pub struct TimerEngine {
    inner: Arc<Mutex<Inner>>,
}

impl TimerEngine {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::new())),
        }
    }

    pub fn spawn_tick_loop(&self, app: AppHandle) {
        let inner = self.inner.clone();
        tauri::async_runtime::spawn(async move {
            let mut interval = time::interval(Duration::from_millis(TICK_INTERVAL_MS));
            loop {
                interval.tick().await;
                let maybe_snapshot = {
                    let mut state = inner.lock();
                    // About-to-end announce: 30s before phase ends, exactly once.
                    if state.is_running()
                        && !state.announced_about_to_end
                        && state.total_ms() > 30_000
                        && state.total_ms().saturating_sub(state.elapsed_ms()) <= 30_000
                    {
                        state.announced_about_to_end = true;
                        let phase = state.phase;
                        drop(state);
                        let _ = app.emit("timer://about-to-end", &phase);
                        // Re-acquire for the rest of the tick. Skip finished-check this tick.
                        Some(inner.lock().snapshot())
                    } else if state.is_running() && state.elapsed_ms() >= state.total_ms() {
                        let finished = state.phase;
                        if finished == Phase::Pomodoro {
                            state.completed_pomodoros = state.completed_pomodoros.saturating_add(1);
                        }
                        let next = state.next_phase_after(finished);
                        let autostart = state.auto_start_for(next);
                        state.begin_phase(next, autostart);
                        let snap = state.snapshot();
                        let pomodoro_duration_s = snap.template.pomodoro_ms / 1000;
                        drop(state);
                        if finished == Phase::Pomodoro {
                            crate::tasks::increment_current(&app);
                            crate::stats::record_pomodoro(&app, pomodoro_duration_s);
                        }
                        let _ = app.emit("timer://phase-finished", &finished);
                        Some(snap)
                    } else if state.is_running() || state.is_paused() {
                        Some(state.snapshot())
                    } else {
                        None
                    }
                };
                if let Some(snap) = maybe_snapshot {
                    let _ = app.emit(TICK_EVENT, &snap);
                }
            }
        });
    }

    fn with<R>(&self, f: impl FnOnce(&mut Inner) -> R) -> R {
        let mut guard = self.inner.lock();
        f(&mut guard)
    }

    pub fn snapshot(&self) -> TimerSnapshot {
        self.inner.lock().snapshot()
    }

    pub fn start(&self, phase: Option<Phase>) -> TimerSnapshot {
        self.with(|s| {
            let next = phase.unwrap_or(match s.phase {
                Phase::Stopped => Phase::Pomodoro,
                other => other,
            });
            s.begin_phase(next, true);
            s.snapshot()
        })
    }

    pub fn pause(&self) -> TimerSnapshot {
        self.with(|s| {
            if s.is_running() {
                s.paused_at = Some(Instant::now());
            }
            s.snapshot()
        })
    }

    pub fn resume(&self) -> TimerSnapshot {
        self.with(|s| {
            if let (Some(started), Some(paused)) = (s.started_at, s.paused_at) {
                let paused_for = Instant::now().saturating_duration_since(paused);
                s.started_at = Some(started + paused_for);
                s.paused_at = None;
            }
            s.snapshot()
        })
    }

    pub fn skip(&self, app: &AppHandle) -> TimerSnapshot {
        self.with(|s| {
            let finished = s.phase;
            if finished == Phase::Pomodoro && s.elapsed_ms() >= s.total_ms() / 2 {
                s.completed_pomodoros = s.completed_pomodoros.saturating_add(1);
            }
            let next = s.next_phase_after(finished);
            let was_running = s.is_running();
            let autostart = was_running && s.auto_start_for(next);
            s.begin_phase(next, autostart);
            let _ = app.emit("timer://phase-skipped", &finished);
            s.snapshot()
        })
    }

    pub fn reset(&self) -> TimerSnapshot {
        self.with(|s| {
            s.phase = Phase::Stopped;
            s.started_at = None;
            s.paused_at = None;
            s.completed_pomodoros = 0;
            s.snapshot()
        })
    }

    pub fn set_template(&self, template: SessionTemplate) -> TimerSnapshot {
        self.with(|s| {
            s.template = template;
            s.snapshot()
        })
    }

    pub fn set_auto_starts(&self, breaks: bool, pomodoros: bool) {
        self.with(|s| {
            s.auto_start_breaks = breaks;
            s.auto_start_pomodoros = pomodoros;
        });
    }
}

#[tauri::command]
pub fn timer_snapshot(engine: State<TimerEngine>) -> TimerSnapshot {
    engine.snapshot()
}

#[tauri::command]
pub fn timer_start(engine: State<TimerEngine>, phase: Option<Phase>) -> TimerSnapshot {
    engine.start(phase)
}

#[tauri::command]
pub fn timer_pause(engine: State<TimerEngine>) -> TimerSnapshot {
    engine.pause()
}

#[tauri::command]
pub fn timer_resume(engine: State<TimerEngine>) -> TimerSnapshot {
    engine.resume()
}

#[tauri::command]
pub fn timer_skip(app: AppHandle, engine: State<TimerEngine>) -> TimerSnapshot {
    engine.skip(&app)
}

#[tauri::command]
pub fn timer_reset(engine: State<TimerEngine>) -> TimerSnapshot {
    engine.reset()
}

#[tauri::command]
pub fn timer_set_template(engine: State<TimerEngine>, template: SessionTemplate) -> TimerSnapshot {
    engine.set_template(template)
}

#[tauri::command]
pub fn timer_set_auto_starts(
    engine: State<TimerEngine>,
    breaks: bool,
    pomodoros: bool,
) -> TimerSnapshot {
    engine.set_auto_starts(breaks, pomodoros);
    engine.snapshot()
}

pub fn register(app: &AppHandle) -> TimerEngine {
    let engine = TimerEngine::new();
    app.manage(engine.clone());
    engine.spawn_tick_loop(app.clone());
    engine
}
