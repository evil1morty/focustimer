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

const els = {
  list: document.getElementById("task-list"),
  count: document.getElementById("task-count"),
  form: document.getElementById("add-task-form"),
  input: document.getElementById("add-task-input"),
  currentTaskTitle: document.getElementById("current-task-title"),
  handle: document.getElementById("task-drawer-handle"),
};

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

function ensureIndicator() {
  if (!dropIndicator) {
    dropIndicator = document.createElement("li");
    dropIndicator.className = "drop-indicator";
    dropIndicator.setAttribute("aria-hidden", "true");
  }
  return dropIndicator;
}

function clearIndicator() {
  dropIndicator?.remove();
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderTaskRow(task) {
  const li = document.createElement("li");
  li.className = "task-row";
  li.dataset.id = String(task.id);
  if (task.is_current) li.classList.add("is-current");
  if (task.completed) li.classList.add("is-done");
  li.draggable = true;
  const safeTitle = escapeHtml(task.title);
  const playLabel = task.is_current
    ? "Start a pomodoro on this task"
    : "Pick and start this task";
  li.innerHTML = `
    <button class="task-check" data-act="toggle" aria-label="Toggle complete">
      <span class="check-box"></span>
    </button>
    <span class="task-title" title="${safeTitle}">${safeTitle}</span>
    <button class="task-count" data-act="edit-est" title="Click to change estimate"
            aria-label="${task.done_pomodoros} of ${task.est_pomodoros} pomodoros — click to edit">
      ${task.done_pomodoros}/${task.est_pomodoros}
    </button>
    <button class="task-play" data-act="play" title="Start working on this task"
            aria-label="${playLabel}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
        <polygon points="6 4 20 12 6 20 6 4" />
      </svg>
    </button>
    <button class="task-del" data-act="del" aria-label="Delete">×</button>
  `;
  return li;
}

function renderHandle(current) {
  if (!els.count) return;
  const handleLabel = els.handle?.querySelector(".label");
  const open = tasks.filter((t) => !t.completed).length;
  const runningCurrent =
    current && timerState.isRunning && timerState.phase === "pomodoro";
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
  els.list.innerHTML = "";
  for (const t of tasks) els.list.appendChild(renderTaskRow(t));
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
  // Wait for the post-tasks://changed render to run, then highlight the row.
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

function startEditEst(countEl, task) {
  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.max = "20";
  input.value = String(task.est_pomodoros);
  input.className = "task-count-edit";
  input.setAttribute("aria-label", "Estimated pomodoros");
  countEl.replaceWith(input);
  input.focus();
  input.select();
  const commit = async () => {
    const parsed = parseInt(input.value, 10);
    const next = Math.max(1, Math.min(20, Number.isFinite(parsed) ? parsed : task.est_pomodoros));
    if (next !== task.est_pomodoros) {
      await tasksUpdate(task.id, { est_pomodoros: next });
    } else {
      render();
    }
  };
  input.addEventListener("blur", commit, { once: true });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") {
      input.removeEventListener("blur", commit);
      render();
    }
  });
}

function startInlineEdit(titleEl, task) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = task.title;
  input.className = "task-title-edit";
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  const commit = async () => {
    const next = input.value.trim();
    if (next && next !== task.title) {
      await tasksUpdate(task.id, { title: next });
    } else {
      render();
    }
  };
  input.addEventListener("blur", commit, { once: true });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") {
      input.removeEventListener("blur", commit);
      render();
    }
  });
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
    if (confirm(`Delete "${task.title}"?`)) await tasksDelete(id);
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
  els.list.querySelectorAll("input").forEach((input) => input.blur());
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
  const orderedIds = Array.from(els.list.querySelectorAll(".task-row")).map((el) =>
    Number(el.dataset.id),
  );
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
    const changed =
      snap.phase !== timerState.phase || snap.is_running !== timerState.isRunning;
    timerState = { phase: snap.phase, isRunning: snap.is_running };
    if (changed) {
      const current = tasks.find((t) => t.is_current && !t.completed);
      renderHandle(current);
    }
  });
}
