/**
 * Single entry point for all Rust ↔ JS communication.
 * Wrap window.__TAURI__ so feature modules don't reach into the global
 * directly and we have one place to add typing, logging, or shims.
 *
 * @typedef {"stopped"|"pomodoro"|"short_break"|"long_break"} Phase
 *
 * @typedef {object} SessionTemplate
 * @property {number} pomodoro_ms
 * @property {number} short_break_ms
 * @property {number} long_break_ms
 * @property {number} cycles_per_long_break
 *
 * @typedef {object} TimerSnapshot
 * @property {Phase} phase
 * @property {number} elapsed_ms
 * @property {number} total_ms
 * @property {number} remaining_ms
 * @property {boolean} is_running
 * @property {boolean} is_paused
 * @property {number} completed_pomodoros
 * @property {number} cycles_per_long_break
 * @property {SessionTemplate} template
 *
 * @typedef {object} Task
 * @property {number} id
 * @property {string} title
 * @property {number} est_pomodoros
 * @property {number} done_pomodoros
 * @property {boolean} completed
 * @property {number} position
 * @property {boolean} is_current
 * @property {number} created_at
 *
 * @typedef {object} AppSettings
 * @property {number} pomodoro_min
 * @property {number} short_break_min
 * @property {number} long_break_min
 * @property {number} cycles_per_long_break
 * @property {boolean} auto_start_breaks
 * @property {boolean} auto_start_pomodoros
 * @property {string} alarm_sound
 * @property {number} alarm_volume
 * @property {string} ticking_sound
 * @property {number} ticking_volume
 * @property {boolean} announce_about_to_end
 * @property {string} theme
 * @property {boolean} autostart
 * @property {boolean} minimize_to_tray
 * @property {boolean} pause_on_lock
 * @property {string} hotkey_toggle
 * @property {string} hotkey_skip
 * @property {string} hotkey_reset
 */

const core = window.__TAURI__?.core;
const event = window.__TAURI__?.event;

if (!core || !event) {
  console.error("Tauri runtime not detected. Are you running outside `tauri dev`?");
}

/**
 * Invoke a Rust command. Errors are surfaced as Error instances with the
 * server-side message so callers can `try/catch` naturally.
 *
 * @template T
 * @param {string} cmd
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<T>}
 */
export async function invoke(cmd, args) {
  try {
    return await core.invoke(cmd, args);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : (e?.message ?? String(e)));
  }
}

/**
 * Subscribe to an event emitted from Rust. Returns the unlisten fn.
 *
 * @template T
 * @param {string} name
 * @param {(payload: T) => void} cb
 * @returns {Promise<() => void>}
 */
export function listen(name, cb) {
  return event.listen(name, (e) => cb(e.payload));
}

/* --------- Timer commands ---------- */

/** @returns {Promise<TimerSnapshot>} */
export const timerSnapshot = () => invoke("timer_snapshot");
/** @param {Phase} [phase] @returns {Promise<TimerSnapshot>} */
export const timerStart = (phase) => invoke("timer_start", { phase });
export const timerPause = () => invoke("timer_pause");
export const timerResume = () => invoke("timer_resume");
export const timerSkip = () => invoke("timer_skip");
export const timerReset = () => invoke("timer_reset");
/** @param {SessionTemplate} template */
export const timerSetTemplate = (template) => invoke("timer_set_template", { template });
/** @param {boolean} breaks @param {boolean} pomodoros */
export const timerSetAutoStarts = (breaks, pomodoros) =>
  invoke("timer_set_auto_starts", { breaks, pomodoros });

/* --------- Task commands ---------- */

/** @returns {Promise<Task[]>} */
export const tasksList = () => invoke("tasks_list");
/** @param {string} title @param {number} [estPomodoros] @returns {Promise<Task>} */
export const tasksCreate = (title, estPomodoros = 1) =>
  invoke("tasks_create", { title, estPomodoros });
/** @param {number} id @param {Partial<Task>} patch */
export const tasksUpdate = (id, patch) => invoke("tasks_update", { id, patch });
/** @param {number} id */
export const tasksDelete = (id) => invoke("tasks_delete", { id });
/** @param {number[]} orderedIds */
export const tasksReorder = (orderedIds) => invoke("tasks_reorder", { orderedIds });
/** @param {number|null} id */
export const tasksSetCurrent = (id) => invoke("tasks_set_current", { id });

/* --------- Settings commands ---------- */

/** @returns {Promise<AppSettings>} */
export const settingsGet = () => invoke("settings_get");
/** @param {AppSettings} settings @returns {Promise<AppSettings>} */
export const settingsSet = (settings) => invoke("settings_set", { settings });

/* --------- Event channels ---------- */

export const Events = Object.freeze({
  TIMER_TICK: "timer://tick",
  TIMER_PHASE_FINISHED: "timer://phase-finished",
  TIMER_PHASE_SKIPPED: "timer://phase-skipped",
  TIMER_ABOUT_TO_END: "timer://about-to-end",
  TASKS_CHANGED: "tasks://changed",
  SETTINGS_CHANGED: "settings://changed",
  TRAY_OPEN_SETTINGS: "tray://open-settings",
});
