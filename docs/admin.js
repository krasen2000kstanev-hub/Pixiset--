import { config } from "./config.js";
import { h, ask, toast, fmtBytes, fmtDate, session } from "./common.js";
import { checkFiles, uploadPhotos } from "./upload.js";

const root = document.querySelector("#root");

// ---------- auth: Cognito hosted UI, Authorization Code + PKCE ----------

const K = { token: "pixiset_token", exp: "pixiset_token_exp", refresh: "pixiset_refresh", verifier: "pixiset_pkce", state: "pixiset_state" };
const redirectUri = location.origin + location.pathname;
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const clearSession = () => Object.values(K).forEach((k) => session.remove(k));

/** Current access token, or null when it has expired (or is about to). */
const token = () => {
  const exp = Number(session.get(K.exp) || 0);
  return exp > Date.now() + 30_000 ? session.get(K.token) : null;
};

function storeTokens(data) {
  session.set(K.token, data.access_token);
  session.set(K.exp, String(Date.now() + (Number(data.expires_in) || 3600) * 1000));
  if (data.refresh_token) session.set(K.refresh, data.refresh_token);
}

const tokenRequest = (params) =>
  fetch(`${config.cognito}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, ...params }),
  });

let refreshing = null;
/** Valid access token, silently refreshed when possible so long uploads survive the 1h expiry. */
async function ensureToken() {
  const current = token();
  if (current) return current;
  const refreshToken = session.get(K.refresh);
  if (!refreshToken) return null;
  refreshing ||= (async () => {
    try {
      const res = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
      if (!res.ok) { clearSession(); return null; }
      storeTokens(await res.json());
      return token();
    } catch {
      return null; // offline: keep the refresh token and let the caller retry later
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function startLogin() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  session.set(K.verifier, verifier);
  session.set(K.state, state);
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
  if (params.get("state") !== session.get(K.state)) return "Невалидна сесия за вход. Опитай пак.";
  const res = await tokenRequest({ grant_type: "authorization_code", code: params.get("code"), redirect_uri: redirectUri, code_verifier: session.get(K.verifier) || "" });
  session.remove(K.verifier);
  session.remove(K.state);
  if (!res.ok) return "Входът не успя. Опитай пак.";
  storeTokens(await res.json());
  return null;
}

function logout() {
  clearSession();
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
  "invalid-order": "Подредбата не е валидна. Презареди страницата и опитай пак.",
  "upload-missing": "Файлът не е качен докрай.",
  "not-found": "Не е намерено.",
};

class SessionExpired extends Error {}

async function api(path, { method = "GET", body, signal } = {}) {
  const t = await ensureToken();
  if (!t) { showLogin("Сесията е изтекла. Влез отново."); throw new SessionExpired("Сесията е изтекла."); }
  const res = await fetch(config.api + path, {
    method, signal,
    headers: { authorization: `Bearer ${t}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { clearSession(); showLogin("Сесията е изтекла. Влез отново."); throw new SessionExpired("Сесията е изтекла."); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(ERRORS[data.error] || `Грешка ${res.status}`);
  return data;
}

const run = async (fn) => {
  try { return await fn(); } catch (error) { if (!(error instanceof SessionExpired) && error.name !== "AbortError") toast(error.message, "error"); return undefined; }
};

// ---------- uploads in progress ----------

let activeUpload = null; // AbortController while photos are being uploaded
addEventListener("beforeunload", (e) => { if (activeUpload) { e.preventDefault(); e.returnValue = ""; } });

// ---------- screens ----------

function showLogin(message) {
  root.replaceChildren(
    h("section", { class: "login" },
      h("p", { class: "brand" }, "Pixiset / Team"),
      h("h1", {}, "Админ галерия"),
      h("p", {}, message || "Влез като член на екипа, за да управляваш галериите."),
      h("button", { class: "btn btn-primary", onclick: startLogin }, "Вход")));
}

const clientUrl = (g) => `${location.origin}${location.pathname.replace(/admin\.html$/, "")}gallery.html?slug=${encodeURIComponent(g.slug)}`;

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

/** Same slot-refill rule the API uses: the given photos keep their positions and take the new order. */
const applyOrder = (all, ids) => {
  const wanted = new Set(ids);
  const byId = new Map(all.map((p) => [p.id, p]));
  let k = 0;
  return all.map((p) => (wanted.has(p.id) ? byId.get(ids[k++]) : p));
};

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
  let alive = true; // false once the visitor navigated to another screen
  const stop = () => { alive = false; removeEventListener("hashchange", stop); };
  addEventListener("hashchange", stop);

  const body = h("div");
  const header = h("div");
  const save = async (patch, success = "Запазено") => {
    const data = await run(() => api(`/admin/galleries/${id}`, { method: "PATCH", body: patch }));
    if (data) { gallery = { ...gallery, ...data.gallery }; toast(success, "success"); if (alive) drawHeader(); }
    return Boolean(data);
  };
  const reload = async () => {
    const [l, p] = await Promise.all([run(() => api("/admin/galleries")), run(() => api(`/admin/galleries/${id}/photos`))]);
    if (l && p && alive) { gallery = l.galleries.find((g) => g.id === id) || gallery; photos = p.photos; drawHeader(); drawTab(); }
  };

  function drawHeader() {
    const link = clientUrl(gallery);
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
          h("button", { class: "btn", onclick: async () => { try { await navigator.clipboard.writeText(link); toast("Линкът е копиран", "success"); } catch { toast("Копирането не успя — маркирай линка ръчно.", "error"); } } }, "Копирай"),
          h("a", { class: "btn", href: link, target: "_blank", rel: "noopener" }, "Отвори"),
          h("button", { class: "btn", onclick: changeSlug }, "Промени адреса")),
        gallery.status !== "PUBLISHED" ? h("p", { class: "muted", style: "margin:12px 0 0" }, "Галерията е чернова — клиентите не я виждат, докато не я публикуваш.") : null),
      h("div", { class: "tabs", role: "tablist" },
        [["photos", `Снимки (${photos.length})`], ["settings", "Настройки"], ["activity", "Активност"]].map(([key, label]) =>
          h("button", { role: "tab", "aria-selected": String(tab === key), onclick: () => { tab = key; drawHeader(); drawTab(); } }, label))));
  }

  async function changeSlug() {
    const v = await ask({ title: "Адрес на галерията", ok: "Запази", fields: [{ name: "slug", label: "Адрес (slug)", value: gallery.slug, required: true, pattern: "[a-z0-9]+(-[a-z0-9]+)*", max: 60, hint: "Малки латински букви, цифри и тирета. Старите линкове с този адрес спират да работят." }] });
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
    if (setFilter !== "ALL" && !sets.includes(setFilter)) setFilter = "ALL";
    const uploadSet = h("select", { "aria-label": "Сет за новите снимки", style: "width:auto" }, sets.map((s) => h("option", { value: s }, s)));
    const input = h("input", { type: "file", multiple: true, accept: "image/jpeg,image/png,image/webp", class: "visually-hidden", id: "picker" });
    const status = h("div", { "aria-live": "polite" });

    const startUpload = async (files) => {
      if (activeUpload) return toast("Качването вече върви.");
      const { accepted, rejected } = checkFiles(files);
      if (rejected.length) toast(`Пропуснати ${rejected.length}: ${rejected[0].reason} (${rejected[0].file.name})`, "error");
      if (!accepted.length) return;
      const controller = new AbortController();
      activeUpload = controller;
      const leave = () => controller.abort();
      addEventListener("hashchange", leave, { once: true });
      const bar = h("i");
      const list = h("ul", { class: "upload-list" });
      status.replaceChildren(h("div", { class: "row" }, h("span", { class: "grow" }, "Качване…"), h("button", { class: "btn btn-small", onclick: leave }, "Откажи")), h("div", { class: "progress" }, bar), list);
      let items;
      try {
        items = await uploadPhotos({
          files: accepted, galleryId: id, setName: uploadSet.value, api, signal: controller.signal,
          concurrency: matchMedia("(max-width:600px)").matches ? 2 : 3,
          onUpdate: (all) => {
            const done = all.filter((i) => i.status === "done").length;
            bar.style.width = `${Math.round((done / all.length) * 100)}%`;
            list.replaceChildren(...all.filter((i) => i.status !== "wait").slice(-8).map((i) => h("li", { class: i.status === "error" ? "error" : "" }, h("span", {}, i.file.name), h("span", {}, { work: "качва се…", done: "готово", error: i.error, cancelled: "отказано" }[i.status]))));
          },
        });
      } finally {
        activeUpload = null;
        removeEventListener("hashchange", leave);
      }
      const failed = items.filter((i) => i.status === "error" || i.status === "cancelled");
      const ok = items.length - failed.length;
      toast(failed.length ? `Качени ${ok} от ${items.length}. ${failed.length} не успяха.` : `Качени ${ok} снимки`, failed.length ? "error" : "success");
      if (!alive) return;
      if (failed.length) status.append(h("button", { class: "btn btn-small", onclick: () => startUpload(failed.map((i) => i.file)) }, `Опитай пак (${failed.length})`));
      else status.replaceChildren();
      await reload();
    };
    input.addEventListener("change", () => { startUpload([...input.files]); input.value = ""; });

    const drop = h("label", { class: "drop", for: "picker", tabindex: "0", ondragover: (e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); drop.classList.add("over"); } }, ondragleave: () => drop.classList.remove("over"),
      ondrop: (e) => { e.preventDefault(); drop.classList.remove("over"); startUpload([...e.dataTransfer.files]); },
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } } },
      "Пусни снимки тук или натисни за избор", h("br"), h("small", { class: "muted" }, "JPEG, PNG, WebP до 50 MB. Оригиналите се пазят непокътнати."));

    const grid = h("div", { class: "photo-grid" });
    const more = h("button", { class: "btn", style: "margin-top:16px", onclick: () => { visible += 60; drawGrid(); } });
    const filter = h("select", { "aria-label": "Покажи сет", style: "width:auto", onchange: (e) => { setFilter = e.target.value; visible = 60; drawGrid(); } },
      h("option", { value: "ALL" }, "Всички сетове"), sets.map((s) => h("option", { value: s, selected: s === setFilter }, s)));

    // ----- manual ordering: drag & drop on desktop, arrow buttons everywhere (incl. touch) -----
    let dragId = null;
    let saving = Promise.resolve();
    const shownPhotos = () => photos.filter((p) => setFilter === "ALL" || p.setName === setFilter).slice(0, visible);

    function commitOrder(ids) {
      const current = shownPhotos().map((p) => p.id);
      if (ids.length < 2 || ids.join() === current.join()) return;
      photos = applyOrder(photos, ids); // optimistic
      drawGrid();
      saving = saving.then(async () => {
        const ok = await run(() => api(`/admin/galleries/${id}/order`, { method: "POST", body: { order: ids } }));
        if (!ok) await reload(); // server refused: show the real order again
      });
    }

    const move = (pid, to) => {
      const ids = shownPhotos().map((p) => p.id);
      const from = ids.indexOf(pid);
      if (from < 0) return;
      const target = Math.max(0, Math.min(ids.length - 1, to));
      ids.splice(target, 0, ids.splice(from, 1)[0]);
      commitOrder(ids);
    };

    function drawGrid() {
      const all = photos.filter((p) => setFilter === "ALL" || p.setName === setFilter);
      const shown = all.slice(0, visible);
      grid.replaceChildren(...shown.map((p, index) => photoTile(p, index, shown.length)));
      more.textContent = `Покажи още (${all.length - visible})`;
      more.hidden = all.length <= visible;
      if (!all.length) grid.replaceChildren(h("p", { class: "empty" }, "Още няма снимки."));
    }

    function photoTile(p, index, count) {
      const isCover = gallery.coverPhotoId === p.id;
      const tile = h("div", {
        class: `photo${isCover ? " is-cover" : ""}`, draggable: count > 1, dataset: { id: p.id },
        ondragstart: (e) => { dragId = p.id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", p.id); setTimeout(() => tile.classList.add("dragging"), 0); },
        ondragend: () => { dragId = null; tile.classList.remove("dragging"); grid.querySelectorAll(".drop-target").forEach((n) => n.classList.remove("drop-target")); },
        ondragover: (e) => { if (dragId && dragId !== p.id) { e.preventDefault(); tile.classList.add("drop-target"); } },
        ondragleave: () => tile.classList.remove("drop-target"),
        ondrop: (e) => { e.preventDefault(); tile.classList.remove("drop-target"); if (dragId && dragId !== p.id) move(dragId, shownPhotos().findIndex((x) => x.id === p.id)); },
      },
        h("img", { src: p.url, alt: p.filename, loading: "lazy", decoding: "async", width: 400, height: 300, draggable: false }),
        h("div", { class: "photo-body" },
          h("span", { class: "photo-name", title: p.filename }, `${index + 1}. ${p.filename}`),
          h("span", { class: "muted" }, `${fmtBytes(p.size)}${isCover ? " · Корица" : ""}`),
          count > 1 ? h("div", { class: "photo-actions", role: "group", "aria-label": "Подредба" },
            h("button", { class: "btn btn-small", disabled: index === 0, "aria-label": "В началото", title: "В началото", onclick: () => move(p.id, 0) }, "⇤"),
            h("button", { class: "btn btn-small", disabled: index === 0, "aria-label": "По-напред", title: "По-напред", onclick: () => move(p.id, index - 1) }, "←"),
            h("button", { class: "btn btn-small", disabled: index === count - 1, "aria-label": "По-назад", title: "По-назад", onclick: () => move(p.id, index + 1) }, "→"),
            h("button", { class: "btn btn-small", disabled: index === count - 1, "aria-label": "В края", title: "В края", onclick: () => move(p.id, count - 1) }, "⇥")) : null,
          h("div", { class: "photo-actions" },
            h("button", { class: "btn btn-small", disabled: isCover, onclick: async () => { if (await save({ coverPhotoId: p.id }, "Корицата е сменена")) drawGrid(); } }, "Корица"),
            h("button", { class: "btn btn-small", onclick: async () => {
              const v = await ask({ title: "Ново име", ok: "Запази", fields: [{ name: "filename", label: "Име на файла", value: p.filename, required: true, max: 120 }] });
              if (v && (await run(() => api(`/admin/photos/${p.id}`, { method: "PATCH", body: v })))) { p.filename = v.filename; drawGrid(); }
            } }, "Име"),
            h("button", { class: "btn btn-small btn-danger", onclick: async () => {
              if (!(await ask({ title: "Изтриване на снимка", message: `„${p.filename}“ ще бъде изтрита завинаги, заедно с оригинала.`, ok: "Изтрий", danger: true }))) return;
              if (await run(() => api(`/admin/photos/${p.id}`, { method: "DELETE" }))) { toast("Снимката е изтрита", "success"); await reload(); }
            } }, "Изтрий")),
          sets.length > 1
            ? h("select", { "aria-label": "Сет", style: "min-height:36px", onchange: async (e) => { if (await run(() => api(`/admin/photos/${p.id}`, { method: "PATCH", body: { setName: e.target.value } }))) { p.setName = e.target.value; drawGrid(); } } },
              sets.map((s) => h("option", { value: s, selected: s === p.setName }, s)))
            : null));
      return tile;
    }

    body.replaceChildren(h("div", { class: "panel" },
      h("div", { class: "row", style: "margin-bottom:12px" }, h("span", { class: "muted" }, "Качи в сет:"), uploadSet, input),
      drop, status),
      h("div", { class: "row", style: "margin-bottom:8px" }, filter, h("span", { class: "muted" }, `${photos.length} снимки · ${fmtBytes(photos.reduce((n, p) => n + (p.size || 0), 0))}`)),
      photos.length > 1 ? h("p", { class: "muted", style: "margin:0 0 16px;font-size:13px" }, "Влачи снимките или ползвай стрелките, за да смениш реда. Така ги вижда и клиентът.") : null,
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

    const currentSets = gallery.sets?.length ? gallery.sets : ["Highlights"];
    const sets = h("div", { class: "panel" },
      h("h2", {}, "Сетове"),
      h("div", { class: "row", style: "margin-bottom:16px" }, currentSets.map((s) =>
        h("span", { class: "chip set-chip" }, s,
          currentSets.length > 1 ? h("button", { class: "chip-x", "aria-label": `Премахни сет ${s}`, title: "Премахни сета", onclick: async () => {
            const rest = currentSets.filter((x) => x !== s);
            const ok = await ask({ title: "Премахване на сет", message: `Снимките от „${s}“ ще се преместят в „${rest[0]}“. Самите снимки не се изтриват.`, ok: "Премахни", danger: true });
            if (ok && (await save({ sets: rest }, "Сетът е премахнат"))) await reload().then(() => drawSettings());
          } }, "×") : null))),
      h("button", { class: "btn", onclick: async () => {
        const v = await ask({ title: "Нов сет", ok: "Добави", fields: [{ name: "name", label: "Име на сета", required: true, max: 60, placeholder: "Церемония" }] });
        if (v && (await save({ sets: [...new Set([...currentSets, v.name.trim()])] }, "Сетът е добавен"))) drawSettings();
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
    if (!data || tab !== "activity" || !alive) return;
    const events = data.events;
    const by = (...actions) => events.filter((e) => actions.includes(e.action));
    const names = new Map(photos.map((p) => [p.id, p.filename]));
    const table = (head, rows) => h("div", { class: "table-wrap" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, head.map((c) => h("th", {}, c)))),
      h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c) => h("td", {}, c)))))));

    const selections = by("SELECTION");
    const downloads = by("DOWNLOAD", "DOWNLOAD_ARCHIVE");
    const failedPasswords = by("PASSWORD_FAIL").length;
    body.replaceChildren(
      h("div", { class: "stats" },
        [["Посещения", by("CLIENT_VISIT").length], ["Сваляния", downloads.length], ["Селекции", selections.length], ...(failedPasswords ? [["Грешни пароли", failedPasswords]] : [])]
          .map(([label, n]) => h("div", { class: "stat" }, h("b", {}, n), label))),
      h("div", { class: "panel" }, h("h2", {}, "Селекции от клиенти"),
        selections.length ? selections.map((s) => h("div", { style: "padding:12px 0;border-top:1px solid var(--border)" },
          h("div", { class: "row" },
            h("strong", { class: "grow" }, `${s.name} · ${s.email}`),
            h("span", { class: "muted" }, `${s.photoIds.length} снимки · ${fmtDate(s.createdAt, true)}`),
            h("button", { class: "btn btn-small", onclick: async () => { try { await navigator.clipboard.writeText(s.photoIds.map((pid) => names.get(pid) || pid).join("\n")); toast("Списъкът с файлове е копиран", "success"); } catch { toast("Копирането не успя.", "error"); } } }, "Копирай имената")),
          s.note ? h("p", { class: "muted", style: "margin:6px 0 0" }, s.note) : null))
          : h("p", { class: "empty" }, "Още няма изпратени селекции.")),
      h("div", { class: "panel" }, h("h2", {}, "Сваляния"),
        downloads.length ? table(["Кога", "Какво", "IP"], downloads.slice(0, 100).map((e) => [
          fmtDate(e.createdAt, true),
          e.action === "DOWNLOAD_ARCHIVE" ? `ZIP: ${e.count} снимки (${e.scope === "selection" ? "избрани" : "всички"}) · ${fmtBytes(e.bytes)}` : e.filename || names.get(e.photoId) || "—",
          e.ip || "—"])) : h("p", { class: "empty" }, "Още няма сваляния.")),
      h("div", { class: "panel" }, h("h2", {}, "Посещения"),
        by("CLIENT_VISIT").length ? table(["Кога", "IP", "Браузър"], by("CLIENT_VISIT").slice(0, 100).map((e) => [fmtDate(e.createdAt, true), e.ip || "—", (e.userAgent || "—").slice(0, 70)])) : h("p", { class: "empty" }, "Още няма посещения.")));
  }

  root.replaceChildren(header, body);
  drawHeader();
  drawTab();
}

// ---------- router ----------

async function route() {
  if (!(await ensureToken())) return showLogin();
  const id = location.hash.replace(/^#\/?/, "");
  if (id) await detailScreen(id); else await listScreen();
}

addEventListener("hashchange", route);

(async () => {
  const error = await finishLogin().catch(() => "Входът не успя. Опитай пак.");
  if (error) return showLogin(error);
  await route();
})();
