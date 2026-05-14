const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const PHASE_LABEL = {
  stopped: "Ready",
  pomodoro: "Focusing",
  short_break: "Short break",
  long_break: "Long break",
};

const PHASE_TIMER_DEFAULT = {
  pomodoro: "pomodoro_ms",
  short_break: "short_break_ms",
  long_break: "long_break_ms",
};

const RING_CIRCUMFERENCE = 2 * Math.PI * 46; // matches r=46 in the SVG

const els = {
  body: document.body,
  display: document.getElementById("timer-display"),
  primary: document.getElementById("btn-primary"),
  skip: document.getElementById("btn-skip"),
  cycleBar: document.getElementById("cycle-bar"),
  phaseLabel: document.getElementById("phase-label"),
  ringProgress: document.getElementById("ring-progress"),
  currentTaskTitle: document.getElementById("current-task-title"),
};

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
  const total = snap.phase === "stopped"
    ? snap.template.pomodoro_ms
    : snap.total_ms;
  const elapsed = snap.phase === "stopped" ? 0 : snap.elapsed_ms;
  const ratio = total > 0 ? Math.min(1, elapsed / total) : 0;
  // Ring counts DOWN — full at start, empty when phase ends.
  const offset = RING_CIRCUMFERENCE * ratio;
  els.ringProgress.style.strokeDashoffset = offset.toString();
}

function render(snap) {
  lastSnap = snap;
  const phase = snap.phase;
  els.body.dataset.phase = phase;

  const showMs = phase === "stopped"
    ? snap.template[PHASE_TIMER_DEFAULT.pomodoro]
    : snap.remaining_ms;
  const text = fmtMs(showMs);
  els.display.textContent = text;
  document.title = `${text} · ${PHASE_LABEL[phase] || "FocusTimer"} — FocusTimer`;

  els.phaseLabel.textContent = PHASE_LABEL[phase] || "FocusTimer";

  let label;
  if (snap.is_running) label = "Pause";
  else if (snap.is_paused) label = "Resume";
  else label = "Start";
  els.primary.textContent = label;

  renderRing(snap);
  renderCycleBar(snap);
}

async function refresh() {
  const snap = await invoke("timer_snapshot");
  render(snap);
}

async function onPrimary() {
  if (!lastSnap) return refresh();
  if (lastSnap.is_running) {
    render(await invoke("timer_pause"));
  } else if (lastSnap.is_paused) {
    render(await invoke("timer_resume"));
  } else {
    const phase = lastSnap.phase === "stopped" ? "pomodoro" : lastSnap.phase;
    render(await invoke("timer_start", { phase }));
  }
}

async function onSkip() {
  render(await invoke("timer_skip"));
}

function bind() {
  els.primary.addEventListener("click", onPrimary);
  els.skip.addEventListener("click", onSkip);

  // Click the phase pill to cycle phases manually (start in that phase).
  document.getElementById("phase-pill")?.addEventListener("click", async () => {
    if (!lastSnap) return;
    const order = ["pomodoro", "short_break", "long_break"];
    const cur = lastSnap.phase === "stopped" ? "pomodoro" : lastSnap.phase;
    const next = order[(order.indexOf(cur) + 1) % order.length];
    render(await invoke("timer_start", { phase: next }));
  });

  document.getElementById("btn-settings")?.addEventListener("click", () => {
    console.log("settings — TODO task #6");
  });
  document.getElementById("btn-stats")?.addEventListener("click", () => {
    console.log("stats — TODO task #11");
  });

  const form = document.getElementById("add-task-form");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("add-task-input");
    if (input.value.trim()) {
      console.log("add task — TODO task #5:", input.value);
      input.value = "";
    }
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  bind();
  await refresh();
  await listen("timer://tick", (e) => render(e.payload));
});
