import { audioPreview, Events, listen, settingsGet, settingsSet } from "./api.js";
import { $$, byId } from "./dom.js";

const els = {
  panel: byId("settings-screen"),
  back: byId("btn-settings-back"),
  open: byId("btn-settings"),

  pomodoro: byId("set-pomodoro"),
  pomodoroVal: byId("set-pomodoro-val"),
  shortBreak: byId("set-short-break"),
  shortBreakVal: byId("set-short-break-val"),
  longBreak: byId("set-long-break"),
  longBreakVal: byId("set-long-break-val"),
  cycles: byId("set-cycles"),

  autoBreaks: byId("set-auto-breaks"),
  autoPomos: byId("set-auto-pomos"),
  announce: byId("set-announce"),
  pauseOnLock: byId("set-pause-on-lock"),

  alarmSound: byId("set-alarm-sound"),
  alarmVolume: byId("set-alarm-volume"),
  alarmVolumeVal: byId("set-alarm-volume-val"),
  tickingSound: byId("set-ticking-sound"),
  tickingVolume: byId("set-ticking-volume"),
  tickingVolumeVal: byId("set-ticking-volume-val"),

  themeSeg: byId("set-theme"),

  hotkeyToggle: byId("set-hotkey-toggle"),
  hotkeySkip: byId("set-hotkey-skip"),
  hotkeyReset: byId("set-hotkey-reset"),

  autostart: byId("set-autostart"),
  minimizeToTray: byId("set-minimize-to-tray"),

  alarmPreview: byId("set-alarm-preview"),
  tickingPreview: byId("set-ticking-preview"),
};

// Cached theme-segment buttons. The control is static markup so the
// NodeList captured at module load is stable; no need to re-query per
// render or per click.
const themeButtons = els.themeSeg ? $$("button", els.themeSeg) : [];

/** @type {import("./api.js").AppSettings|null} */
let current = null;
let saveTimer = null;

function setView(view) {
  // Single source of truth — CSS keys hide/show off body[data-view] alone.
  document.body.dataset.view = view;
}

function applyTheme(theme) {
  document.body.dataset.theme = theme || "system";
}

/** @param {import("./api.js").AppSettings} s */
function render(s) {
  current = s;
  applyTheme(s.theme);
  els.pomodoro.value = s.pomodoro_min;
  els.pomodoroVal.textContent = `${s.pomodoro_min} min`;
  els.shortBreak.value = s.short_break_min;
  els.shortBreakVal.textContent = `${s.short_break_min} min`;
  els.longBreak.value = s.long_break_min;
  els.longBreakVal.textContent = `${s.long_break_min} min`;
  els.cycles.value = s.cycles_per_long_break;

  els.autoBreaks.checked = s.auto_start_breaks;
  els.autoPomos.checked = s.auto_start_pomodoros;
  els.announce.checked = s.announce_about_to_end;
  els.pauseOnLock.checked = s.pause_on_lock;

  els.alarmSound.value = s.alarm_sound;
  els.alarmVolume.value = Math.round(s.alarm_volume * 100);
  els.alarmVolumeVal.textContent = `${els.alarmVolume.value}%`;
  els.tickingSound.value = s.ticking_sound;
  els.tickingVolume.value = Math.round(s.ticking_volume * 100);
  els.tickingVolumeVal.textContent = `${els.tickingVolume.value}%`;

  themeButtons.forEach((b) => {
    b.classList.toggle("active", b.dataset.val === s.theme);
  });

  els.hotkeyToggle.textContent = s.hotkey_toggle;
  els.hotkeySkip.textContent = s.hotkey_skip;
  els.hotkeyReset.textContent = s.hotkey_reset;

  els.autostart.checked = s.autostart;
  els.minimizeToTray.checked = s.minimize_to_tray;
}

/** @returns {import("./api.js").AppSettings} */
function gather() {
  return {
    pomodoro_min: Number(els.pomodoro.value),
    short_break_min: Number(els.shortBreak.value),
    long_break_min: Number(els.longBreak.value),
    cycles_per_long_break: Math.max(2, Math.min(8, Number(els.cycles.value) || 4)),
    auto_start_breaks: els.autoBreaks.checked,
    auto_start_pomodoros: els.autoPomos.checked,
    announce_about_to_end: els.announce.checked,
    pause_on_lock: els.pauseOnLock.checked,
    alarm_sound: els.alarmSound.value,
    alarm_volume: Number(els.alarmVolume.value) / 100,
    ticking_sound: els.tickingSound.value,
    ticking_volume: Number(els.tickingVolume.value) / 100,
    theme: current?.theme ?? "system",
    autostart: els.autostart.checked,
    minimize_to_tray: els.minimizeToTray.checked,
    hotkey_toggle: current?.hotkey_toggle ?? "Ctrl+Alt+P",
    hotkey_skip: current?.hotkey_skip ?? "Ctrl+Alt+S",
    hotkey_reset: current?.hotkey_reset ?? "Ctrl+Alt+R",
  };
}

function scheduleSave() {
  const settings = gather();
  els.pomodoroVal.textContent = `${settings.pomodoro_min} min`;
  els.shortBreakVal.textContent = `${settings.short_break_min} min`;
  els.longBreakVal.textContent = `${settings.long_break_min} min`;
  els.alarmVolumeVal.textContent = `${Math.round(settings.alarm_volume * 100)}%`;
  els.tickingVolumeVal.textContent = `${Math.round(settings.ticking_volume * 100)}%`;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      current = await settingsSet(settings);
    } catch (e) {
      console.error("settings_set failed", e);
    }
  }, 100);
}

function bindControls() {
  const watch = [
    els.pomodoro,
    els.shortBreak,
    els.longBreak,
    els.cycles,
    els.autoBreaks,
    els.autoPomos,
    els.announce,
    els.pauseOnLock,
    els.alarmSound,
    els.alarmVolume,
    els.tickingSound,
    els.tickingVolume,
    els.autostart,
    els.minimizeToTray,
  ];
  for (const el of watch) {
    el.addEventListener("input", scheduleSave);
    el.addEventListener("change", scheduleSave);
  }
  els.alarmPreview?.addEventListener("click", () => {
    const sound = els.alarmSound.value;
    const volume = Number(els.alarmVolume.value) / 100;
    audioPreview(sound, volume).catch((e) => console.error("audio_preview failed", e));
  });
  els.tickingPreview?.addEventListener("click", () => {
    const sound = els.tickingSound.value;
    const volume = Number(els.tickingVolume.value) / 100;
    audioPreview(sound, volume).catch((e) => console.error("audio_preview failed", e));
  });

  els.themeSeg.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-val]");
    if (!btn) return;
    current.theme = btn.dataset.val;
    applyTheme(current.theme);
    themeButtons.forEach((b) => b.classList.toggle("active", b === btn));
    scheduleSave();
  });
}

export async function initSettings() {
  els.open?.addEventListener("click", () => setView("settings"));
  els.back?.addEventListener("click", () => setView("timer"));
  try {
    render(await settingsGet());
  } catch (e) {
    console.error("settings_get failed", e);
  }
  bindControls();
  listen(Events.SETTINGS_CHANGED, (payload) => payload && render(payload));
  listen(Events.TRAY_OPEN_SETTINGS, () => setView("settings"));
}
