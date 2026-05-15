import {
  Events,
  listen,
  tasksCreate,
  tasksDelete,
  tasksList,
  tasksReorder,
  tasksSetCurrent,
  tasksUpdate,
  timerStart,
} from "./api.js";
import { showConfirm } from "./modal.js";
import { $$, byId, h, on, setChildren } from "./dom.js";

const els = {
  list: byId("task-list"),
  count: byId("task-count"),
  form: byId("add-task-form"),
  input: byId("add-task-input"),
  currentTaskTitle: byId("current-task-title"),
  currentTaskHeadline: byId("current-task"),
  handle: byId("task-drawer-handle"),
};

/** @type {import("./api.js").Task[]} */
let tasks = [];
let dragId = null;
/**
 * Cached timer state — populated from TIMER_TICK so the drawer handle and
 * task rows can reflect whether a pomodoro is currently in progress for the
 * active task without polling.
 */
let timerState = { phase: "stopped", isRunning: false };
/** @type {HTMLElement|null} */
let dropIndicator = null;

function openDrawer() {
  document.body.dataset.tasks = "open";
  els.handle?.setAttribute("aria-expanded", "true");
  els.handle?.setAttribute("aria-label", "Hide tasks");
}

function closeDrawer() {
  document.body.dataset.tasks = "closed";
  els.handle?.setAttribute("aria-expanded", "false");
  els.handle?.setAttribute("aria-label", "Show tasks");
}

function toggleDrawer() {
  if (document.body.dataset.tasks === "open") closeDrawer();
  else openDrawer();
}

function ensureIndicator() {
  if (!dropIndicator) {
    dropIndicator = h("li", { class: "drop-indicator", "aria-hidden": "true" });
  }
  return dropIndicator;
}

function clearIndicator() {
  dropIndicator?.remove();
}

/** Build a task row. Children are passed as text nodes via h(), so the
 *  task title can never escape into HTML — no manual escapeHtml needed. */
function renderTaskRow(task) {
  const playLabel = task.is_current ? "Start a pomodoro on this task" : "Pick and start this task";
  const cls = ["task-row", task.is_current && "is-current", task.completed && "is-done"]
    .filter(Boolean)
    .join(" ");
  return h(
    "li",
    { class: cls, draggable: true, dataset: { id: task.id } },
    h(
      "button",
      {
        class: "task-check",
        "data-act": "toggle",
        "aria-label": "Toggle complete",
      },
      h("span", { class: "check-box" }),
    ),
    h("span", { class: "task-title", title: task.title }, task.title),
    h(
      "button",
      {
        class: "task-count",
        "data-act": "edit-est",
        title: "Click to change estimate",
        "aria-label": `${task.done_pomodoros} of ${task.est_pomodoros} pomodoros — click to edit`,
      },
      `${task.done_pomodoros}/${task.est_pomodoros}`,
    ),
    h(
      "button",
      {
        class: "task-play",
        "data-act": "play",
        title: "Start working on this task",
        "aria-label": playLabel,
      },
      h(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: "13",
          height: "13",
          fill: "currentColor",
          "aria-hidden": "true",
        },
        h("polygon", { points: "6 4 20 12 6 20 6 4" }),
      ),
    ),
    h("button", { class: "task-del", "data-act": "del", "aria-label": "Delete" }, "×"),
  );
}

function renderHandle(current) {
  if (!els.count) return;
  const handleLabel = els.handle?.querySelector(".label");
  const open = tasks.filter((t) => !t.completed).length;
  const runningCurrent = current && timerState.isRunning && timerState.phase === "pomodoro";
  if (runningCurrent) {
    if (handleLabel) handleLabel.textContent = "Now";
    els.count.textContent = current.title;
    els.handle?.classList.add("is-running");
  } else {
    if (handleLabel) handleLabel.textContent = "Tasks";
    els.count.textContent = tasks.length ? `${open} open / ${tasks.length}` : "";
    els.handle?.classList.remove("is-running");
  }
}

function render() {
  setChildren(els.list, tasks.map(renderTaskRow));
  const open = tasks.filter((t) => !t.completed).length;
  const current = tasks.find((t) => t.is_current && !t.completed);
  renderHandle(current);
  if (els.currentTaskTitle) {
    let label;
    let clickable = false;
    if (current) {
      label = current.title;
    } else if (open > 0) {
      // There ARE open tasks but none is current — guide the user to pick one.
      label = "Pick a task below to track focus";
      clickable = true;
    } else {
      // Either no tasks at all, or every task is already done. Either way the
      // only useful action is to add a new task; don't promise something the
      // user can't deliver on.
      label = "Add a task below ↓";
      clickable = true;
    }
    els.currentTaskTitle.textContent = label;
    els.currentTaskTitle.classList.toggle("is-empty", !current);
    els.currentTaskTitle.classList.toggle("is-clickable", clickable);
    els.currentTaskHeadline?.classList.toggle("has-current", !!current);
    if (clickable) {
      els.currentTaskTitle.setAttribute("role", "button");
      els.currentTaskTitle.setAttribute("tabindex", "0");
    } else {
      els.currentTaskTitle.removeAttribute("role");
      els.currentTaskTitle.removeAttribute("tabindex");
    }
  }
}

/**
 * Flash a row after the user picks it so the change of state registers.
 * The class is removed after the animation; the row keeps its is-current
 * styling from the next render() (which lands via the tasks://changed event).
 */
function flashSelection(id) {
  requestAnimationFrame(() => {
    const row = els.list.querySelector(`.task-row[data-id="${id}"]`);
    if (!row) return;
    row.classList.add("just-selected");
    setTimeout(() => row.classList.remove("just-selected"), 600);
  });
}

async function refresh() {
  try {
    tasks = await tasksList();
    render();
  } catch (e) {
    console.error("tasks_list failed", e);
  }
}

/** Wraps the shared blur/keydown machinery for inline edits so we only
 *  have to describe what to do on commit + how to seed the input. */
function startInlineEditor(targetEl, init, commit) {
  const input = init();
  targetEl.replaceWith(input);
  input.focus();
  input.select();
  let cancelled = false;
  const unbindBlur = on(input, "blur", () => {
    if (!cancelled) commit(input);
  });
  on(input, "keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") {
      cancelled = true;
      unbindBlur();
      render();
    }
  });
}

function startEditEst(countEl, task) {
  startInlineEditor(
    countEl,
    () =>
      h("input", {
        type: "number",
        min: "1",
        max: "20",
        value: String(task.est_pomodoros),
        class: "task-count-edit",
        "aria-label": "Estimated pomodoros",
      }),
    async (input) => {
      const parsed = parseInt(input.value, 10);
      const next = Math.max(1, Math.min(20, Number.isFinite(parsed) ? parsed : task.est_pomodoros));
      if (next !== task.est_pomodoros) {
        await tasksUpdate(task.id, { est_pomodoros: next });
      } else {
        render();
      }
    },
  );
}

function startInlineEdit(titleEl, task) {
  startInlineEditor(
    titleEl,
    () =>
      h("input", {
        type: "text",
        value: task.title,
        class: "task-title-edit",
      }),
    async (input) => {
      const next = input.value.trim();
      if (next && next !== task.title) {
        await tasksUpdate(task.id, { title: next });
      } else {
        render();
      }
    },
  );
}

async function handleClick(e) {
  const li = e.target.closest(".task-row");
  if (!li) return;
  const id = Number(li.dataset.id);
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "toggle") {
    await tasksUpdate(id, { completed: !task.completed });
  } else if (act === "del") {
    const ok = await showConfirm({
      title: "Delete task?",
      body: `"${task.title}" will be removed. This can't be undone.`,
      confirmLabel: "Delete",
      cancelLabel: "Keep",
      danger: true,
    });
    if (ok) await tasksDelete(id);
  } else if (act === "edit-est") {
    startEditEst(li.querySelector(".task-count"), task);
  } else if (act === "play") {
    if (task.completed) return;
    await tasksSetCurrent(id);
    await timerStart("pomodoro");
    closeDrawer();
  } else if (!task.completed) {
    await tasksSetCurrent(id);
    flashSelection(id);
  }
}

function handleDblClick(e) {
  const titleEl = e.target.closest(".task-title");
  if (!titleEl) return;
  const li = titleEl.closest(".task-row");
  const id = Number(li.dataset.id);
  const task = tasks.find((t) => t.id === id);
  if (task) startInlineEdit(titleEl, task);
}

async function handleSubmit(e) {
  e.preventDefault();
  const title = els.input.value.trim();
  if (!title) return;
  els.input.value = "";
  try {
    await tasksCreate(title, 1);
  } catch (err) {
    console.error("tasks_create failed", err);
  }
}

function handleDragStart(e) {
  const li = e.target.closest(".task-row");
  if (!li) return;
  // Commit any open inline edit before reordering — otherwise the input
  // gets wiped by the re-render and the user loses their text.
  $$("input", els.list).forEach((input) => input.blur());
  dragId = Number(li.dataset.id);
  li.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
}

function handleDragOver(e) {
  e.preventDefault();
  const li = e.target.closest(".task-row");
  if (!li || dragId == null) return;
  const draggingEl = els.list.querySelector(".dragging");
  if (!draggingEl || draggingEl === li) return;
  const rect = li.getBoundingClientRect();
  const before = e.clientY < rect.top + rect.height / 2;
  const ind = ensureIndicator();
  // Don't place an indicator immediately adjacent to the dragging row;
  // that just means "no-op move".
  const target = before ? li : li.nextSibling;
  if (target === draggingEl || target === draggingEl.nextSibling) {
    clearIndicator();
    return;
  }
  els.list.insertBefore(ind, target);
}

async function handleDragEnd() {
  const draggingEl = els.list.querySelector(".dragging");
  if (dropIndicator?.parentElement && draggingEl) {
    els.list.insertBefore(draggingEl, dropIndicator);
  }
  clearIndicator();
  draggingEl?.classList.remove("dragging");
  if (dragId == null) return;
  dragId = null;
  const orderedIds = $$(".task-row", els.list).map((el) => Number(el.dataset.id));
  await tasksReorder(orderedIds);
}

function handleHeadlineClick() {
  if (!els.currentTaskTitle?.classList.contains("is-clickable")) return;
  openDrawer();
  // Focus the input only when the drawer is fully open so the slide
  // animation isn't interrupted by a competing focus jump.
  setTimeout(() => els.input?.focus(), 280);
}

export function initTasks() {
  els.list.addEventListener("click", handleClick);
  els.list.addEventListener("dblclick", handleDblClick);
  els.list.addEventListener("dragstart", handleDragStart);
  els.list.addEventListener("dragover", handleDragOver);
  els.list.addEventListener("dragend", handleDragEnd);
  els.form.addEventListener("submit", handleSubmit);
  els.handle?.addEventListener("click", toggleDrawer);
  els.currentTaskTitle?.addEventListener("click", handleHeadlineClick);
  els.currentTaskTitle?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleHeadlineClick();
    }
  });
  // Start with drawer closed.
  closeDrawer();
  refresh();
  listen(Events.TASKS_CHANGED, (payload) => {
    tasks = payload;
    render();
  });
  listen(Events.TIMER_TICK, (snap) => {
    if (!snap) return;
    const changed = snap.phase !== timerState.phase || snap.is_running !== timerState.isRunning;
    timerState = { phase: snap.phase, isRunning: snap.is_running };
    if (changed) {
      const current = tasks.find((t) => t.is_current && !t.completed);
      renderHandle(current);
      els.currentTaskHeadline?.classList.toggle("is-running", snap.is_running);
      els.currentTaskHeadline?.classList.toggle("is-pomodoro", snap.phase === "pomodoro");
    }
  });
}
