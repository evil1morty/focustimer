import { Events, listen, statsSummary } from "./api.js";

const els = {
  panel: document.getElementById("stats-screen"),
  back: document.getElementById("btn-stats-back"),
  open: document.getElementById("btn-stats"),
  today: document.getElementById("kpi-today"),
  week: document.getElementById("kpi-week"),
  streak: document.getElementById("kpi-streak"),
  chart: document.getElementById("bar-chart"),
  axis: document.getElementById("bar-axis"),
  totalAllTime: document.getElementById("totals-all-time"),
  totalFocus: document.getElementById("totals-focus"),
};

function setView(view) {
  document.body.dataset.view = view;
  els.panel.hidden = view !== "stats";
}

function fmtHours(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function dayLabel(dateStr) {
  // Compact day-of-week label, rendered for every other day.
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 1);
}

/** @param {import("./api.js").StatsSummary} s */
function renderChart(s) {
  const days = s.daily;
  const max = Math.max(1, ...days.map((d) => d.count));
  const W = 280;
  const H = 110;
  const gap = 4;
  const barW = (W - gap * (days.length - 1)) / days.length;
  let svg = "";
  days.forEach((d, i) => {
    const h = (d.count / max) * (H - 8);
    const x = i * (barW + gap);
    const y = H - h;
    const cls = d.count === 0 ? "empty" : "";
    svg += `<rect class="${cls}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${Math.max(2, h).toFixed(2)}" rx="2" />`;
  });
  els.chart.innerHTML = svg;
  els.axis.innerHTML = days
    .map((d, i) => `<span>${i % 2 === 0 ? dayLabel(d.date) : ""}</span>`)
    .join("");
}

/** @param {import("./api.js").StatsSummary} s */
function render(s) {
  els.today.textContent = String(s.today);
  els.week.textContent = String(s.this_week);
  els.streak.textContent = String(s.streak_days);
  els.totalAllTime.textContent = String(s.all_time);
  els.totalFocus.textContent = fmtHours(s.all_time_focus_seconds);
  renderChart(s);
}

async function refresh() {
  try {
    render(await statsSummary());
  } catch (e) {
    console.error("stats_summary failed", e);
  }
}

export function initStats() {
  els.open?.addEventListener("click", () => {
    setView("stats");
    refresh();
  });
  els.back?.addEventListener("click", () => setView("timer"));
  listen(Events.STATS_CHANGED, refresh);
}
