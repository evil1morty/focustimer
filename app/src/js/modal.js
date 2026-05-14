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

let built = false;
let backdropEl;
let modalEl;
let titleEl;
let bodyEl;
let cancelEl;
let confirmEl;
let currentResolve = null;
let previouslyFocused = null;

function ensureBuilt() {
  if (built) return;
  built = true;

  backdropEl = document.createElement("div");
  backdropEl.className = "modal-backdrop";
  backdropEl.hidden = true;
  backdropEl.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-body">
      <h3 class="modal-title" id="modal-title"></h3>
      <p class="modal-body" id="modal-body"></p>
      <div class="modal-actions">
        <button type="button" class="modal-cancel"></button>
        <button type="button" class="modal-confirm"></button>
      </div>
    </div>
  `;
  document.body.appendChild(backdropEl);

  modalEl = backdropEl.querySelector(".modal");
  titleEl = backdropEl.querySelector(".modal-title");
  bodyEl = backdropEl.querySelector(".modal-body");
  cancelEl = backdropEl.querySelector(".modal-cancel");
  confirmEl = backdropEl.querySelector(".modal-confirm");

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
    // Two-button trap: bounce focus between Cancel and Confirm.
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
  ensureBuilt();
  // If a prior call is still open, cancel it.
  if (currentResolve) resolve(false);

  titleEl.textContent = title;
  bodyEl.textContent = body;
  bodyEl.style.display = body ? "" : "none";
  cancelEl.textContent = cancelLabel;
  confirmEl.textContent = confirmLabel;
  confirmEl.classList.toggle("is-danger", !!danger);
  cancelEl.hidden = false;

  previouslyFocused = document.activeElement;
  backdropEl.hidden = false;
  // Force layout before adding the class so the transition plays.
  void backdropEl.offsetWidth;
  backdropEl.classList.add("is-open");
  // Dangerous actions default focus to Cancel (safer); others to Confirm.
  setTimeout(() => (danger ? cancelEl : confirmEl).focus(), 30);

  return new Promise((res) => {
    currentResolve = res;
  });
}

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.body]
 * @param {string} [opts.confirmLabel]
 * @returns {Promise<void>}
 */
export async function showAlert({ title, body = "", confirmLabel = "OK" }) {
  ensureBuilt();
  if (currentResolve) resolve(false);

  titleEl.textContent = title;
  bodyEl.textContent = body;
  bodyEl.style.display = body ? "" : "none";
  confirmEl.textContent = confirmLabel;
  confirmEl.classList.remove("is-danger");
  cancelEl.hidden = true;

  previouslyFocused = document.activeElement;
  backdropEl.hidden = false;
  void backdropEl.offsetWidth;
  backdropEl.classList.add("is-open");
  setTimeout(() => confirmEl.focus(), 30);

  await new Promise((res) => {
    currentResolve = res;
  });
}
