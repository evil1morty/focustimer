/**
 * Custom confirm / alert dialogs that match the app's visual language —
 * replaces native window.confirm() and window.alert().
 *
 * showConfirm({title, body, confirmLabel?, cancelLabel?, danger?}) -> Promise<boolean>
 * showAlert({title, body, confirmLabel?}) -> Promise<void>
 *
 * Backdrop click and Escape resolve as cancel (false / undefined). Focus is
 * trapped between Cancel and Confirm while open and returned to the element
 * that had focus before the dialog appeared.
 */

import { h } from "./dom.js";

let backdropEl = null;
let titleEl;
let bodyEl;
let cancelEl;
let confirmEl;
let currentResolve = null;
let previouslyFocused = null;

function ensureBuilt() {
  if (backdropEl) return;

  titleEl = h("h3", { class: "modal-title", id: "modal-title" });
  bodyEl = h("p", { class: "modal-body", id: "modal-body" });
  cancelEl = h("button", { type: "button", class: "modal-cancel" });
  confirmEl = h("button", { type: "button", class: "modal-confirm" });

  backdropEl = h(
    "div",
    { class: "modal-backdrop", hidden: true },
    h(
      "div",
      {
        class: "modal",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "modal-title",
        "aria-describedby": "modal-body",
      },
      titleEl,
      bodyEl,
      h("div", { class: "modal-actions" }, cancelEl, confirmEl),
    ),
  );

  document.body.appendChild(backdropEl);

  backdropEl.addEventListener("mousedown", (e) => {
    if (e.target === backdropEl) resolve(false);
  });
  cancelEl.addEventListener("click", () => resolve(false));
  confirmEl.addEventListener("click", () => resolve(true));
  backdropEl.addEventListener("keydown", onKeydown);
}

function onKeydown(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    resolve(false);
    return;
  }
  if (e.key === "Tab") {
    // Two-button trap: bounce focus between Cancel and Confirm. If Cancel
    // is hidden (alert variant) leave default Tab handling.
    if (cancelEl.hidden) return;
    e.preventDefault();
    const active = document.activeElement;
    if (e.shiftKey) {
      (active === cancelEl ? confirmEl : cancelEl).focus();
    } else {
      (active === confirmEl ? cancelEl : confirmEl).focus();
    }
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    resolve(document.activeElement === cancelEl ? false : true);
  }
}

function resolve(value) {
  if (!currentResolve) return;
  const r = currentResolve;
  currentResolve = null;
  backdropEl.classList.remove("is-open");
  // Wait for the fade-out animation before unmounting from the a11y tree.
  setTimeout(() => {
    backdropEl.hidden = true;
  }, 180);
  if (previouslyFocused && typeof previouslyFocused.focus === "function") {
    previouslyFocused.focus();
  }
  previouslyFocused = null;
  r(value);
}

function open({ title, body, confirmLabel, cancelLabel, danger, alert }) {
  ensureBuilt();
  // If a prior call is still open, cancel it before showing the next one.
  if (currentResolve) resolve(false);

  titleEl.textContent = title;
  bodyEl.textContent = body ?? "";
  bodyEl.style.display = body ? "" : "none";
  confirmEl.textContent = confirmLabel;
  confirmEl.classList.toggle("is-danger", !!danger);
  cancelEl.textContent = cancelLabel ?? "";
  cancelEl.hidden = !!alert;

  previouslyFocused = document.activeElement;
  backdropEl.hidden = false;
  // Force a layout pass before setting is-open so the opacity transition
  // actually plays. Without this the class arrives in the same frame the
  // element first paints and no transition runs.
  void backdropEl.offsetWidth;
  backdropEl.classList.add("is-open");

  // Dangerous actions default focus to Cancel (safer). Alerts have no
  // Cancel; everything else defaults focus to Confirm. The 30ms delay
  // lets the Tauri webview settle so focus actually sticks.
  setTimeout(() => {
    if (alert || !danger) confirmEl.focus();
    else cancelEl.focus();
  }, 30);

  return new Promise((res) => {
    currentResolve = res;
  });
}

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.body]
 * @param {string} [opts.confirmLabel]
 * @param {string} [opts.cancelLabel]
 * @param {boolean} [opts.danger]
 * @returns {Promise<boolean>}
 */
export function showConfirm({
  title,
  body = "",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
}) {
  return open({ title, body, confirmLabel, cancelLabel, danger, alert: false });
}

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.body]
 * @param {string} [opts.confirmLabel]
 * @returns {Promise<void>}
 */
export async function showAlert({ title, body = "", confirmLabel = "OK" }) {
  await open({ title, body, confirmLabel, alert: true });
}
