// Tiny shared helpers: DOM builder, dialogs, toasts, formatting.
// Everything that comes from the API is inserted with textContent / DOM APIs,
// never innerHTML, so API data cannot inject markup.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (key in el && key !== "list") el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

export const fmtBytes = (n) => {
  const v = Number(n) || 0;
  if (v < 1024 * 1024) return `${Math.max(1, Math.round(v / 1024))} KB`;
  if (v < 1024 ** 3) return `${(v / 1024 / 1024).toFixed(1)} MB`;
  return `${(v / 1024 ** 3).toFixed(2)} GB`;
};

export const fmtDate = (value, withTime = false) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("bg-BG", withTime
    ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "long", year: "numeric" });
};

let toasts;
export function toast(message, kind = "info") {
  if (!toasts) {
    toasts = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
    document.body.append(toasts);
  }
  const el = h("div", { class: `toast ${kind}` }, message);
  toasts.append(el);
  setTimeout(() => el.remove(), kind === "error" ? 7000 : 3500);
}

/**
 * Native <dialog> form. Resolves with an object of field values on confirm,
 * or null when cancelled. With no fields it works as a confirmation.
 */
export function ask({ title, message, fields = [], ok = "Потвърди", cancel = "Отказ", danger = false }) {
  return new Promise((resolve) => {
    const controls = fields.map((f) => {
      const control = h(f.rows ? "textarea" : "input", {
        name: f.name, type: f.rows ? undefined : f.type || "text", value: f.value ?? "", required: f.required,
        placeholder: f.placeholder, maxLength: f.max, rows: f.rows, autocomplete: f.autocomplete || "off",
        pattern: f.pattern, minLength: f.min,
      });
      return h("label", { class: "field" }, h("span", {}, f.label), control, f.hint ? h("small", {}, f.hint) : null);
    });
    const dlg = h("dialog", { class: "dlg" },
      h("form", { method: "dialog" },
        h("h2", {}, title),
        message ? h("p", { class: "dlg-text" }, message) : null,
        controls,
        h("div", { class: "dlg-actions" },
          h("button", { type: "submit", value: "cancel", formnovalidate: true, class: "btn" }, cancel),
          h("button", { type: "submit", value: "ok", class: danger ? "btn btn-danger" : "btn btn-primary" }, ok))));
    dlg.addEventListener("close", () => {
      const confirmed = dlg.returnValue === "ok";
      const values = Object.fromEntries(new FormData(dlg.querySelector("form")).entries());
      dlg.remove();
      resolve(confirmed ? values : null);
    });
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector("input,textarea")?.focus();
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
