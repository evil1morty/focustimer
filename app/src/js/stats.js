import { Events, listen, statsSummary } from "./api.js";
import { $$, byId, h, setChildren } from "./dom.js";

const els = {
  panel: byId("stats-screen"),
  back: byId("btn-stats-back"),
  open: byId("btn-stats"),
  today: byId("kpi-today"),
  week: byId("kpi-week"),
  streak: byId("kpi-streak"),
  chart: byId("bar-chart"),
  axis: byId("bar-axis"),
  totalAllTime: byId("totals-all-time"),
  totalFocus: byId("totals-focus"),
  empty: byId("stats-empty"),
  kpis: byId("kpi-row"),
  sections: $$(".stats-screen .stats-section"),
};

function setView(view) {
  document.body.dataset.view = view;
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
  setChildren(
    els.chart,
    days.map((d, i) => {
      const barH = (d.count / max) * (H - 8);
      return h("rect", {
        class: d.count === 0 ? "empty" : null,
        x: (i * (barW + gap)).toFixed(2),
        y: (H - barH).toFixed(2),
        width: barW.toFixed(2),
        height: Math.max(2, barH).toFixed(2),
        rx: 2,
      });
    }),
  );
  setChildren(
    els.axis,
    days.map((d, i) => h("span", null, i % 2 === 0 ? dayLabel(d.date) : "")),
  );
}

/** @param {import("./api.js").StatsSummary} s */
function render(s) {
  const isEmpty = s.all_time === 0;
  els.empty.hidden = !isEmpty;
  els.kpis.hidden = isEmpty;
  els.sections.forEach((sec) => {
    sec.hidden = isEmpty;
  });
  if (isEmpty) return;

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
