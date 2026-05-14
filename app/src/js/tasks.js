import {
  Events,
  listen,
  tasksCreate,
  tasksDelete,
  tasksList,
  tasksReorder,
  tasksSetCurrent,
  tasksUpdate,
} from "./api.js";

const els = {
  list: document.getElementById("task-list"),
  count: document.getElementById("task-count"),
  form: document.getElementById("add-task-form"),
  input: document.getElementById("add-task-input"),
  currentTaskTitle: document.getElementById("current-task-title"),
};

/** @type {import("./api.js").Task[]} */
let tasks = [];
let dragId = null;

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
  li.innerHTML = `
    <button class="task-check" data-act="toggle" aria-label="Toggle complete">
      <span class="check-box"></span>
    </button>
    <span class="task-title" data-act="edit" title="Click to edit">${escapeHtml(task.title)}</span>
    <span class="task-count">${task.done_pomodoros}/${task.est_pomodoros}</span>
    <button class="task-del" data-act="del" aria-label="Delete">×</button>
  `;
  return li;
}

function render() {
  els.list.innerHTML = "";
  for (const t of tasks) els.list.appendChild(renderTaskRow(t));
  const open = tasks.filter((t) => !t.completed).length;
  els.count.textContent = tasks.length ? `${open} open / ${tasks.length}` : "";
  const current = tasks.find((t) => t.is_current && !t.completed);
  if (els.currentTaskTitle) {
    let label;
    if (current) {
      label = current.title;
    } else if (tasks.length > 0) {
      label = "Pick a task below to track focus";
    } else {
      label = "Add a task below ↓";
    }
    els.currentTaskTitle.textContent = label;
    els.currentTaskTitle.classList.toggle("is-empty", !current);
  }
}

async function refresh() {
  try {
    tasks = await tasksList();
    render();
  } catch (e) {
    console.error("tasks_list failed", e);
  }
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
  } else if (act === "edit") {
    startInlineEdit(li.querySelector(".task-title"), task);
  } else if (!task.completed) {
    await tasksSetCurrent(id);
  }
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
  els.list.insertBefore(draggingEl, before ? li : li.nextSibling);
}

async function handleDragEnd() {
  els.list.querySelector(".dragging")?.classList.remove("dragging");
  if (dragId == null) return;
  dragId = null;
  const orderedIds = Array.from(els.list.querySelectorAll(".task-row")).map((el) =>
    Number(el.dataset.id),
  );
  await tasksReorder(orderedIds);
}

export function initTasks() {
  els.list.addEventListener("click", handleClick);
  els.list.addEventListener("dragstart", handleDragStart);
  els.list.addEventListener("dragover", handleDragOver);
  els.list.addEventListener("dragend", handleDragEnd);
  els.form.addEventListener("submit", handleSubmit);
  refresh();
  listen(Events.TASKS_CHANGED, (payload) => {
    tasks = payload;
    render();
  });
}
