import {
  Events,
  listen,
  timerPause,
  timerResume,
  timerSkip,
  timerSnapshot,
  timerStart,
} from "./js/api.js";
import { initTasks } from "./js/tasks.js";
import { initSettings } from "./js/settings.js";
import { initStats } from "./js/stats.js";

const PHASE_LABEL = {
  stopped: "Ready",
  pomodoro: "Focusing",
  short_break: "Short break",
  long_break: "Long break",
};

const els = {
  body: document.body,
  display: document.getElementById("timer-display"),
  primary: document.getElementById("btn-primary"),
  skip: document.getElementById("btn-skip"),
  cycleBar: document.getElementById("cycle-bar"),
  phaseLabel: document.getElementById("phase-label"),
  ringProgress: document.getElementById("ring-progress"),
};

const RING_CIRCUMFERENCE = 2 * Math.PI * 46;

/** @type {import("./js/api.js").TimerSnapshot|null} */
let lastSnap = null;

function fmtMs(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function dotsFilled(snap) {
  const n = snap.cycles_per_long_break || 4;
  const done = snap.completed_pomodoros || 0;
  if (done === 0) return 0;
  if (snap.phase === "long_break") return n;
  if (snap.phase === "short_break") return ((done - 1) % n) + 1;
  return done % n;
}

function renderCycleBar(snap) {
  const n = snap.cycles_per_long_break || 4;
  const filled = dotsFilled(snap);
  if (els.cycleBar.childElementCount !== n) {
    els.cycleBar.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const s = document.createElement("span");
      s.className = "seg";
      els.cycleBar.appendChild(s);
    }
  }
  els.cycleBar.querySelectorAll(".seg").forEach((s, i) => {
    s.classList.toggle("filled", i < filled);
  });
}

function renderRing(snap) {
  const total = snap.phase === "stopped" ? snap.template.pomodoro_ms : snap.total_ms;
  const elapsed = snap.phase === "stopped" ? 0 : snap.elapsed_ms;
  const ratio = total > 0 ? Math.min(1, elapsed / total) : 0;
  els.ringProgress.style.strokeDashoffset = (RING_CIRCUMFERENCE * ratio).toString();
}

function render(snap) {
  lastSnap = snap;
  els.body.dataset.phase = snap.phase;

  const showMs = snap.phase === "stopped" ? snap.template.pomodoro_ms : snap.remaining_ms;
  const text = fmtMs(showMs);
  els.display.textContent = text;
  document.title = `${text} · ${PHASE_LABEL[snap.phase] ?? "FocusTimer"} — FocusTimer`;
  els.phaseLabel.textContent = PHASE_LABEL[snap.phase] ?? "FocusTimer";

  if (snap.is_running) els.primary.textContent = "Pause";
  else if (snap.is_paused) els.primary.textContent = "Resume";
  else els.primary.textContent = "Start";

  renderRing(snap);
  renderCycleBar(snap);
}

async function onPrimary() {
  if (!lastSnap) return;
  if (lastSnap.is_running) render(await timerPause());
  else if (lastSnap.is_paused) render(await timerResume());
  else {
    const phase = lastSnap.phase === "stopped" ? "pomodoro" : lastSnap.phase;
    render(await timerStart(phase));
  }
}

function bind() {
  els.primary.addEventListener("click", onPrimary);
  els.skip.addEventListener("click", async () => render(await timerSkip()));

  document.getElementById("phase-pill")?.addEventListener("click", async () => {
    if (!lastSnap) return;
    const order = ["pomodoro", "short_break", "long_break"];
    const cur = lastSnap.phase === "stopped" ? "pomodoro" : lastSnap.phase;
    const next = order[(order.indexOf(cur) + 1) % order.length];
    render(await timerStart(next));
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  bind();
  initTasks();
  initSettings();
  initStats();
  render(await timerSnapshot());
  listen(Events.TIMER_TICK, render);
});
