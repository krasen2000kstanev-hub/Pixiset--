import { config } from "./config.js";
import { h, ask, toast, fmtBytes, fmtDate } from "./common.js";
import { checkFiles, uploadPhotos } from "./upload.js";

const root = document.querySelector("#root");

// ---------- auth: Cognito hosted UI, Authorization Code + PKCE ----------

const K = { token: "pixiset_token", exp: "pixiset_token_exp", verifier: "pixiset_pkce", state: "pixiset_state" };
const redirectUri = location.origin + location.pathname;
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const token = () => {
  const exp = Number(sessionStorage.getItem(K.exp) || 0);
  return exp > Date.now() + 5000 ? sessionStorage.getItem(K.token) : null;
};
const clearToken = () => [K.token, K.exp].forEach((k) => sessionStorage.removeItem(k));

async function startLogin() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem(K.verifier, verifier);
  sessionStorage.setItem(K.state, state);
  location.href = `${config.cognito}/oauth2/authorize?${new URLSearchParams({
    response_type: "code", client_id: config.clientId, redirect_uri: redirectUri, scope: "openid",
    state, code_challenge: challenge, code_challenge_method: "S256",
  })}`;
}

async function finishLogin() {
  const params = new URLSearchParams(location.search);
  if (!params.has("code") && !params.has("error")) return null;
  history.replaceState({}, "", redirectUri + location.hash);
  if (params.has("error")) return "Входът е отказан.";
  if (params.get("state") !== sessionStorage.getItem(K.state)) return "Невалидна сесия за вход. Опитай пак.";
  const res = await fetch(`${config.cognito}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: config.clientId, code: params.get("code"), redirect_uri: redirectUri, code_verifier: sessionStorage.getItem(K.verifier) || "" }),
  });
  sessionStorage.removeItem(K.verifier);
  sessionStorage.removeItem(K.state);
  if (!res.ok) return "Входът не успя. Опитай пак.";
  const data = await res.json();
  sessionStorage.setItem(K.token, data.access_token);
  sessionStorage.setItem(K.exp, String(Date.now() + (Number(data.expires_in) || 3600) * 1000));
  return null;
}

function logout() {
  clearToken();
  location.href = `${config.cognito}/logout?${new URLSearchParams({ client_id: config.clientId, logout_uri: redirectUri })}`;
}

// ---------- API ----------

const ERRORS = {
  "slug-taken": "Този адрес вече се ползва от друга галерия.",
  "invalid-slug": "Адресът може да съдържа само малки латински букви, цифри и тирета.",
  "invalid-title": "Въведи заглавие.",
  "invalid-date": "Невалидна дата.",
  "invalid-image": "Файлът е невалиден (JPEG, PNG или WebP до 50 MB).",
  "invalid-password": "Паролата трябва да е между 4 и 120 символа.",
  "upload-missing": "Файлът не е качен докрай.",
  "not-found": "Не е намерено.",
};

class SessionExpired extends Error {}

async function api(path, { method = "GET", body, signal } = {}) {
  const t = token();
  if (!t) { showLogin("Сесията е изтекла. Влез отново."); throw new SessionExpired("Сесията е изтекла."); }
  const res = await fetch(config.api + path, {
    method, signal,
    headers: { authorization: `Bearer ${t}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { clearToken(); showLogin("Сесията е изтекла. Влез отново."); throw new SessionExpired("Сесията е изтекла."); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(ERRORS[data.error] || `Грешка ${res.status}`);
  return data;
}

const run = async (fn) => {
  try { return await fn(); } catch (error) { if (!(error instanceof SessionExpired) && error.name !== "AbortError") toast(error.message, "error"); return undefined; }
};

// ---------- screens ----------

function showLogin(message) {
  root.replaceChildren(
    h("section", { class: "login" },
      h("p", { class: "brand" }, "Pixiset / Team"),
      h("h1", {}, "Админ галерия"),
      h("p", {}, message || "Влез като член на екипа, за да управляваш галериите."),
      h("button", { class: "btn btn-primary", onclick: startLogin }, "Вход")));
}

const clientUrl = (slug) => `${location.origin}${location.pathname.replace(/admin\.html$/, "")}gallery.html?slug=${encodeURIComponent(slug)}`;

const statusChip = (g) => h("span", { class: `chip ${g.status === "PUBLISHED" ? "published" : "draft"}` }, g.status === "PUBLISHED" ? "Публикувана" : "Чернова");

async function listScreen() {
  root.replaceChildren(h("p", { class: "muted" }, "Зареждане…"));
  const data = await run(() => api("/admin/galleries"));
  if (!data) return;
  const galleries = data.galleries;
  const state = { q: "", status: "ALL" };
  const cards = h("div", { class: "cards" });

  const draw = () => {
    const q = state.q.trim().toLowerCase();
    const shown = galleries.filter((g) => (state.status === "ALL" || g.status === state.status) && (!q || `${g.title} ${g.slug}`.toLowerCase().includes(q)));
    cards.replaceChildren(...shown.map((g) =>
      h("a", { class: "card", href: `#/${g.id}` },
        h("div", { class: "card-cover" }, g.coverUrl ? h("img", { src: g.coverUrl, alt: "", loading: "lazy", decoding: "async" }) : (g.title || "?").slice(0, 1).toUpperCase()),
        h("div", { class: "card-body" },
          h("span", { class: "card-title" }, g.title || "Без име"),
          h("div", { class: "row" }, statusChip(g), g.hasPassword ? h("span", { class: "chip lock" }, "Парола") : null),
          h("span", { class: "card-meta" }, [g.displayDate ? fmtDate(g.displayDate) : null, `${g.photoCount} снимки`, fmtBytes(g.photoBytes)].filter(Boolean).join(" · "))))));
    if (!shown.length) cards.replaceChildren(h("p", { class: "empty" }, galleries.length ? "Няма галерии по този филтър." : "Още няма галерии. Създай първата."));
  };

  root.replaceChildren(
    h("div", { class: "topbar" },
      h("div", {}, h("p", { class: "brand" }, "Pixiset / Team"), h("h1", {}, "Галерии")),
      h("div", { class: "row" },
        h("button", { class: "btn btn-primary", onclick: () => run(newGallery) }, "Нова галерия"),
        h("button", { class: "btn", onclick: logout }, "Изход"))),
    h("div", { class: "row", style: "margin-bottom:24px" },
      h("input", { class: "grow", type: "search", placeholder: "Търси галерия…", "aria-label": "Търси галерия", oninput: (e) => { state.q = e.target.value; draw(); } }),
      h("select", { "aria-label": "Филтър по статус", style: "width:auto", onchange: (e) => { state.status = e.target.value; draw(); } },
        h("option", { value: "ALL" }, "Всички статуси"), h("option", { value: "PUBLISHED" }, "Публикувани"), h("option", { value: "DRAFT" }, "Чернови"))),
    cards);
  draw();
}

async function newGallery() {
  const values = await ask({
    title: "Нова галерия", ok: "Създай",
    fields: [
      { name: "title", label: "Име на галерията", required: true, max: 160, placeholder: "Сватба — Иванови" },
      { name: "displayDate", label: "Дата", type: "date", value: new Date().toISOString().slice(0, 10), required: true },
    ],
  });
  if (!values) return;
  const { gallery } = await api("/admin/galleries", { method: "POST", body: values });
  location.hash = `#/${gallery.id}`;
}

async function detailScreen(id) {
  root.replaceChildren(h("p", { class: "muted" }, "Зареждане…"));
  const [list, photoData] = await Promise.all([run(() => api("/admin/galleries")), run(() => api(`/admin/galleries/${id}/photos`))]);
  if (!list || !photoData) return;
  let gallery = list.galleries.find((g) => g.id === id);
  if (!gallery) { toast("Галерията не е намерена.", "error"); location.hash = "#/"; return; }
  let photos = photoData.photos;
  let tab = "photos";
  let visible = 60;
  let setFilter = "ALL";

  const body = h("div");
  const header = h("div");
  const save = async (patch, success = "Запазено") => {
    const data = await run(() => api(`/admin/galleries/${id}`, { method: "PATCH", body: patch }));
    if (data) { gallery = { ...gallery, ...data.gallery }; toast(success, "success"); drawHeader(); }
    return Boolean(data);
  };
  const reload = async () => {
    const [l, p] = await Promise.all([run(() => api("/admin/galleries")), run(() => api(`/admin/galleries/${id}/photos`))]);
    if (l && p) { gallery = l.galleries.find((g) => g.id === id) || gallery; photos = p.photos; drawHeader(); drawTab(); }
  };

  function drawHeader() {
    const link = clientUrl(gallery.slug);
    header.replaceChildren(
      h("div", { class: "topbar" },
        h("a", { href: "#/", class: "btn" }, "← Всички галерии"),
        h("button", { class: "btn", onclick: logout }, "Изход")),
      h("div", { class: "row", style: "margin-bottom:16px" },
        h("h1", { class: "grow" }, gallery.title || "Без име"), statusChip(gallery),
        h("button", { class: gallery.status === "PUBLISHED" ? "btn" : "btn btn-primary", onclick: () => save({ status: gallery.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED" }, gallery.status === "PUBLISHED" ? "Галерията е скрита" : "Галерията е публикувана") },
          gallery.status === "PUBLISHED" ? "Скрий" : "Публикувай")),
      h("div", { class: "panel" },
        h("div", { class: "row" },
          h("input", { class: "grow", readOnly: true, value: link, "aria-label": "Линк за клиента", onfocus: (e) => e.target.select() }),
          h("button", { class: "btn", onclick: async () => { await navigator.clipboard.writeText(link); toast("Линкът е копиран", "success"); } }, "Копирай"),
          h("a", { class: "btn", href: link, target: "_blank", rel: "noopener" }, "Отвори"),
          h("button", { class: "btn", onclick: changeSlug }, "Промени адреса")),
        gallery.status !== "PUBLISHED" ? h("p", { class: "muted", style: "margin:12px 0 0" }, "Галерията е чернова — клиентите не я виждат, докато не я публикуваш.") : null),
      h("div", { class: "tabs", role: "tablist" },
        [["photos", `Снимки (${photos.length})`], ["settings", "Настройки"], ["activity", "Активност"]].map(([key, label]) =>
          h("button", { role: "tab", "aria-selected": String(tab === key), onclick: () => { tab = key; drawHeader(); drawTab(); } }, label))));
  }

  async function changeSlug() {
    const v = await ask({ title: "Адрес на галерията", ok: "Запази", fields: [{ name: "slug", label: "Адрес (slug)", value: gallery.slug, required: true, pattern: "[a-z0-9]+(-[a-z0-9]+)*", max: 60, hint: "Малки латински букви, цифри и тирета. Старите линкове спират да работят." }] });
    if (v) await save({ slug: v.slug });
  }

  function drawTab() {
    if (tab === "photos") return drawPhotos();
    if (tab === "settings") return drawSettings();
    return drawActivity();
  }

  // ----- photos -----
  function drawPhotos() {
    const sets = gallery.sets?.length ? gallery.sets : ["Highlights"];
    const uploadSet = h("select", { "aria-label": "Сет за новите снимки", style: "width:auto" }, sets.map((s) => h("option", { value: s }, s)));
    const input = h("input", { type: "file", multiple: true, accept: "image/jpeg,image/png,image/webp", class: "visually-hidden", id: "picker" });
    const status = h("div", { "aria-live": "polite" });
    let controller = null;

    const startUpload = async (files) => {
      const { accepted, rejected } = checkFiles(files);
      if (rejected.length) toast(`Пропуснати ${rejected.length}: ${rejected[0].reason} (${rejected[0].file.name})`, "error");
      if (!accepted.length) return;
      controller = new AbortController();
      const bar = h("i");
      const list = h("ul", { class: "upload-list" });
      const cancel = h("button", { class: "btn btn-small", onclick: () => controller.abort() }, "Откажи");
      status.replaceChildren(h("div", { class: "row" }, h("span", { class: "grow" }, "Качване…"), cancel), h("div", { class: "progress" }, bar), list);
      const items = await uploadPhotos({
        files: accepted, galleryId: id, setName: uploadSet.value, api, signal: controller.signal,
        onUpdate: (all) => {
          const done = all.filter((i) => i.status === "done").length;
          bar.style.width = `${Math.round((done / all.length) * 100)}%`;
          list.replaceChildren(...all.filter((i) => i.status !== "wait").slice(-8).map((i) => h("li", { class: i.status === "error" ? "error" : "" }, h("span", {}, i.file.name), h("span", {}, { work: "качва се…", done: "готово", error: i.error, cancelled: "отказано" }[i.status]))));
        },
      });
      const failed = items.filter((i) => i.status === "error" || i.status === "cancelled");
      const ok = items.length - failed.length;
      toast(failed.length ? `Качени ${ok} от ${items.length}. ${failed.length} не успяха.` : `Качени ${ok} снимки`, failed.length ? "error" : "success");
      if (failed.length) {
        status.append(h("button", { class: "btn btn-small", onclick: () => startUpload(failed.map((i) => i.file)) }, `Опитай пак (${failed.length})`));
      } else status.replaceChildren();
      await reload();
    };
    input.addEventListener("change", () => { startUpload([...input.files]); input.value = ""; });

    const drop = h("label", { class: "drop", for: "picker", tabindex: "0", ondragover: (e) => { e.preventDefault(); drop.classList.add("over"); }, ondragleave: () => drop.classList.remove("over"),
      ondrop: (e) => { e.preventDefault(); drop.classList.remove("over"); startUpload([...e.dataTransfer.files]); },
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } } },
      "Пусни снимки тук или натисни за избор", h("br"), h("small", { class: "muted" }, "JPEG, PNG, WebP до 50 MB. Оригиналите се пазят непокътнати."));

    const grid = h("div", { class: "photo-grid" });
    const more = h("button", { class: "btn", style: "margin-top:16px", onclick: () => { visible += 60; drawGrid(); } });
    const filter = h("select", { "aria-label": "Покажи сет", style: "width:auto", onchange: (e) => { setFilter = e.target.value; visible = 60; drawGrid(); } },
      h("option", { value: "ALL" }, "Всички сетове"), sets.map((s) => h("option", { value: s, selected: s === setFilter }, s)));

    function drawGrid() {
      const shown = photos.filter((p) => setFilter === "ALL" || p.setName === setFilter);
      grid.replaceChildren(...shown.slice(0, visible).map((p) => photoTile(p, sets)));
      more.textContent = `Покажи още (${shown.length - visible})`;
      more.hidden = shown.length <= visible;
      if (!shown.length) grid.replaceChildren(h("p", { class: "empty" }, "Още няма снимки."));
    }

    function photoTile(p, allSets) {
      const isCover = gallery.coverPhotoId === p.id;
      return h("div", { class: `photo${isCover ? " is-cover" : ""}` },
        h("img", { src: p.url, alt: p.filename, loading: "lazy", decoding: "async", width: 400, height: 300 }),
        h("div", { class: "photo-body" },
          h("span", { class: "photo-name", title: p.filename }, p.filename),
          h("span", { class: "muted" }, `${fmtBytes(p.size)}${isCover ? " · Корица" : ""}`),
          h("div", { class: "photo-actions" },
            h("button", { class: "btn btn-small", disabled: isCover, onclick: async () => { if (await save({ coverPhotoId: p.id }, "Корицата е сменена")) drawGrid(); } }, isCover ? "Корица" : "Корица"),
            h("button", { class: "btn btn-small", onclick: async () => {
              const v = await ask({ title: "Ново име", ok: "Запази", fields: [{ name: "filename", label: "Име на файла", value: p.filename, required: true, max: 120 }] });
              if (v && (await run(() => api(`/admin/photos/${p.id}`, { method: "PATCH", body: v })))) { p.filename = v.filename; drawGrid(); }
            } }, "Име"),
            h("button", { class: "btn btn-small btn-danger", onclick: async () => {
              if (!(await ask({ title: "Изтриване на снимка", message: `„${p.filename}“ ще бъде изтрита завинаги, заедно с оригинала.`, ok: "Изтрий", danger: true }))) return;
              if (await run(() => api(`/admin/photos/${p.id}`, { method: "DELETE" }))) { toast("Снимката е изтрита", "success"); await reload(); }
            } }, "Изтрий")),
          allSets.length > 1
            ? h("select", { "aria-label": "Сет", class: "btn-small", style: "min-height:36px", onchange: async (e) => { if (await run(() => api(`/admin/photos/${p.id}`, { method: "PATCH", body: { setName: e.target.value } }))) p.setName = e.target.value; } },
              allSets.map((s) => h("option", { value: s, selected: s === p.setName }, s)))
            : null));
    }

    body.replaceChildren(h("div", { class: "panel" },
      h("div", { class: "row", style: "margin-bottom:12px" }, h("span", { class: "muted" }, "Качи в сет:"), uploadSet, input),
      drop, status),
      h("div", { class: "row", style: "margin-bottom:16px" }, filter, h("span", { class: "muted" }, `${photos.length} снимки · ${fmtBytes(photos.reduce((n, p) => n + (p.size || 0), 0))}`)),
      grid, more);
    drawGrid();
  }

  // ----- settings -----
  function drawSettings() {
    const f = (name) => form.elements[name];
    const form = h("form", { class: "panel", onsubmit: async (e) => {
      e.preventDefault();
      const patch = { title: f("title").value, displayDate: f("displayDate").value, description: f("description").value, downloadEnabled: f("downloadEnabled").checked, expiresAt: f("expiresAt").value || null };
      if (f("password").value) patch.password = f("password").value;
      if (await save(patch, "Настройките са запазени")) { f("password").value = ""; drawSettings(); }
    } },
      h("h2", {}, "Основни"),
      h("label", { class: "field" }, h("span", {}, "Заглавие"), h("input", { name: "title", value: gallery.title || "", required: true, maxLength: 160 })),
      h("label", { class: "field" }, h("span", {}, "Дата на събитието"), h("input", { name: "displayDate", type: "date", value: gallery.displayDate || "", required: true })),
      h("label", { class: "field" }, h("span", {}, "Описание"), h("textarea", { name: "description", rows: 3, maxLength: 2000, value: gallery.description || "" })),
      h("h2", { style: "margin-top:24px" }, "Достъп на клиента"),
      h("label", { class: "field" }, h("span", {}, gallery.hasPassword ? "Нова парола (остави празно, за да запазиш текущата)" : "Парола (по избор)"), h("input", { name: "password", type: "text", minLength: 4, maxLength: 120, autocomplete: "off", placeholder: gallery.hasPassword ? "•••• (зададена)" : "Без парола" })),
      gallery.hasPassword ? h("button", { type: "button", class: "btn btn-small", style: "margin-bottom:16px", onclick: async () => { if (await save({ password: null }, "Паролата е премахната")) drawSettings(); } }, "Премахни паролата") : null,
      h("label", { class: "field" }, h("span", {}, "Достъпът изтича на"), h("input", { name: "expiresAt", type: "date", value: gallery.expiresAt || "" })),
      h("label", { class: "check" }, h("input", { name: "downloadEnabled", type: "checkbox", checked: gallery.downloadEnabled !== false }), "Клиентите могат да свалят снимки"),
      h("button", { class: "btn btn-primary", type: "submit" }, "Запази"));

    const sets = h("div", { class: "panel" },
      h("h2", {}, "Сетове"),
      h("div", { class: "row", style: "margin-bottom:16px" }, (gallery.sets || ["Highlights"]).map((s) => h("span", { class: "chip" }, s))),
      h("button", { class: "btn", onclick: async () => {
        const v = await ask({ title: "Нов сет", ok: "Добави", fields: [{ name: "name", label: "Име на сета", required: true, max: 60, placeholder: "Церемония" }] });
        if (v && (await save({ sets: [...new Set([...(gallery.sets || ["Highlights"]), v.name.trim()])] }, "Сетът е добавен"))) drawSettings();
      } }, "+ Нов сет"));

    const danger = h("div", { class: "panel" },
      h("h2", {}, "Опасна зона"),
      h("p", { class: "muted" }, "Изтриването премахва галерията и всички нейни снимки (включително оригиналите)."),
      h("button", { class: "btn btn-danger", onclick: async () => {
        if (!(await ask({ title: "Изтриване на галерия", message: `„${gallery.title}“ и ${photos.length} снимки ще бъдат изтрити завинаги.`, ok: "Изтрий галерията", danger: true }))) return;
        if (await run(() => api(`/admin/galleries/${id}`, { method: "DELETE" }))) { toast("Галерията е изтрита", "success"); location.hash = "#/"; }
      } }, "Изтрий галерията"));

    body.replaceChildren(form, sets, danger);
  }

  // ----- activity -----
  async function drawActivity() {
    body.replaceChildren(h("p", { class: "muted" }, "Зареждане…"));
    const data = await run(() => api(`/admin/galleries/${id}/activity`));
    if (!data || tab !== "activity") return;
    const events = data.events;
    const by = (action) => events.filter((e) => e.action === action);
    const names = new Map(photos.map((p) => [p.id, p.filename]));
    const table = (head, rows) => h("div", { class: "table-wrap" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, head.map((c) => h("th", {}, c)))),
      h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c) => h("td", {}, c)))))));

    const selections = by("SELECTION");
    body.replaceChildren(
      h("div", { class: "stats" },
        [["Посещения", by("CLIENT_VISIT").length], ["Сваляния", by("DOWNLOAD").length], ["Селекции", selections.length]].map(([label, n]) => h("div", { class: "stat" }, h("b", {}, n), label))),
      h("div", { class: "panel" }, h("h2", {}, "Селекции от клиенти"),
        selections.length ? selections.map((s) => h("div", { style: "padding:12px 0;border-top:1px solid var(--border)" },
          h("div", { class: "row" },
            h("strong", { class: "grow" }, `${s.name} · ${s.email}`),
            h("span", { class: "muted" }, `${s.photoIds.length} снимки · ${fmtDate(s.createdAt, true)}`),
            h("button", { class: "btn btn-small", onclick: async () => { await navigator.clipboard.writeText(s.photoIds.map((pid) => names.get(pid) || pid).join("\n")); toast("Списъкът с файлове е копиран", "success"); } }, "Копирай имената")),
          s.note ? h("p", { class: "muted", style: "margin:6px 0 0" }, s.note) : null))
          : h("p", { class: "empty" }, "Още няма изпратени селекции.")),
      h("div", { class: "panel" }, h("h2", {}, "Сваляния"),
        by("DOWNLOAD").length ? table(["Кога", "Файл", "IP"], by("DOWNLOAD").slice(0, 100).map((e) => [fmtDate(e.createdAt, true), e.filename || names.get(e.photoId) || "—", e.ip || "—"])) : h("p", { class: "empty" }, "Още няма сваляния.")),
      h("div", { class: "panel" }, h("h2", {}, "Посещения"),
        by("CLIENT_VISIT").length ? table(["Кога", "IP", "Браузър"], by("CLIENT_VISIT").slice(0, 100).map((e) => [fmtDate(e.createdAt, true), e.ip || "—", (e.userAgent || "—").slice(0, 70)])) : h("p", { class: "empty" }, "Още няма посещения.")));
  }

  root.replaceChildren(header, body);
  drawHeader();
  drawTab();
}

// ---------- router ----------

async function route() {
  if (!token()) return showLogin();
  const id = location.hash.replace(/^#\/?/, "");
  if (id) await detailScreen(id); else await listScreen();
}

addEventListener("hashchange", route);

(async () => {
  const error = await finishLogin().catch(() => "Входът не успя. Опитай пак.");
  if (error) return showLogin(error);
  await route();
})();
