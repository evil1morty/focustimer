/**
 * Tiny DOM helpers. Deliberately small — this is not a framework, just a
 * way to (a) replace document.getElementById boilerplate, (b) build DOM
 * trees without ever touching innerHTML, and (c) attach listeners that
 * hand back an unbind function.
 *
 * Public surface:
 *   byId(id)                   → Element | null
 *   $$(selector, root?)        → Element[]
 *   h(tag, props?, ...kids)    → Element  (safe; SVG-aware)
 *   setChildren(el, ...kids)   → void     (wipes + appends)
 *   on(el, event, fn, opts?)   → () => void  (unbind)
 */

/** Shortcut for document.getElementById. */
export const byId = (id) => document.getElementById(id);

/** Array view of querySelectorAll so callers can .map / .filter / .find. */
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/**
 * SVG elements need createElementNS to be drawn correctly. Any tag in this
 * set is created in the SVG namespace; everything else is HTML.
 */
const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_TAGS = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "filter",
  "feTurbulence",
  "feColorMatrix",
  "ellipse",
]);

/**
 * Hyperscript-style element factory. Children that aren't Nodes are
 * wrapped as text nodes — so any string passed in is rendered as text,
 * never parsed as HTML. That property is the whole point of using h()
 * over innerHTML: user-supplied content (task titles, day labels) can
 * never escape.
 *
 * Props:
 *   class / className   → el.setAttribute("class", value)
 *   dataset: {...}      → el.dataset.<key> = value
 *   style:   {...}      → Object.assign(el.style, ...)
 *   onClick, onInput…   → addEventListener("click", "input", …)
 *   <anything else>     → setAttribute(key, value)
 *                         (value=true sets the empty string;
 *                         value=false|null|undefined skips the attr)
 *
 * @param {string} tag
 * @param {Record<string, unknown>|null} [props]
 * @param  {...(Node|string|number|boolean|null|undefined|Array)} children
 * @returns {Element}
 */
export function h(tag, props, ...children) {
  const el = SVG_TAGS.has(tag)
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);
  if (props) {
    for (const key in props) {
      const value = props[key];
      if (value == null || value === false) continue;
      if (key === "class" || key === "className") {
        el.setAttribute("class", String(value));
      } else if (key === "dataset" && typeof value === "object") {
        for (const dk in value) {
          if (value[dk] != null) el.dataset[dk] = String(value[dk]);
        }
      } else if (key === "style" && typeof value === "object") {
        Object.assign(el.style, value);
      } else if (key.startsWith("on") && typeof value === "function") {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else {
        el.setAttribute(key, value === true ? "" : String(value));
      }
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) {
      appendChildren(el, child);
    } else if (child instanceof Node) {
      el.appendChild(child);
    } else {
      el.appendChild(document.createTextNode(String(child)));
    }
  }
}

/** Wipe an element's children and append a new set. */
export function setChildren(el, ...children) {
  while (el.firstChild) el.removeChild(el.firstChild);
  appendChildren(el, children);
}

/**
 * addEventListener + a tear-down handle. Useful for short-lived listeners
 * (e.g. an inline edit's blur handler) where we want to compose
 * remove-on-event with remove-on-escape without duplicating the call.
 */
export function on(el, event, handler, opts) {
  el.addEventListener(event, handler, opts);
  return () => el.removeEventListener(event, handler, opts);
}
