import { config } from "./config.js";
import { h, ask, toast, fmtDate, sleep } from "./common.js";

const root = document.querySelector("#root");
const params = new URLSearchParams(location.search);
const ref = params.get("slug") ? `slug/${encodeURIComponent(params.get("slug"))}` : params.get("id") ? encodeURIComponent(params.get("id")) : "";
const pwKey = `pixiset-pw:${ref}`;
let password = sessionStorage.getItem(pwKey) || "";

const gfetch = (path, init = {}) =>
  fetch(config.api + path, { ...init, headers: { ...(init.headers || {}), ...(password ? { "x-gallery-password": password } : {}) } });

// ---------- states ----------

const state = (title, text, ...actions) =>
  root.replaceChildren(h("main", { class: "state" }, h("h1", {}, title), h("p", {}, text), h("div", { class: "row", style: "justify-content:center" }, actions)));

const skeleton = () => root.replaceChildren(h("div", { class: "skeleton", "aria-label": "Зареждане" }, Array.from({ length: 12 }, () => h("i"))));

function gate(message) {
  const input = h("input", { type: "password", required: true, autocomplete: "current-password", "aria-label": "Парола", placeholder: "Парола" });
  const error = h("p", { role: "alert", style: "color:var(--error);margin:0", hidden: !message }, message || "");
  root.replaceChildren(h("main", { class: "state" },
    h("h1", {}, "Защитена галерия"),
    h("p", {}, "Въведи паролата, която си получил от фотографа."),
    h("form", { class: "row", style: "justify-content:center", onsubmit: (e) => {
      e.preventDefault();
      password = input.value;
      sessionStorage.setItem(pwKey, password);
      load(true);
    } }, input, h("button", { class: "btn btn-primary", type: "submit" }, "Отвори")),
    error));
  input.focus();
}

// ---------- data ----------

async function load(fromGate = false) {
  if (!ref) return state("Галерията не е намерена", "Линкът изглежда непълен. Поискай нов от фотографа.");
  skeleton();
  let res;
  try {
    res = await gfetch(`/galleries/${ref}`);
  } catch {
    return state("Няма връзка", "Провери интернета и опитай отново.", h("button", { class: "btn btn-primary", onclick: () => load() }, "Опитай пак"));
  }
  if (res.status === 401) { sessionStorage.removeItem(pwKey); password = ""; return gate(fromGate ? "Паролата не е вярна." : ""); }
  if (res.status === 404) return state("Галерията не е намерена", "Линкът може да е неточен или галерията още не е публикувана.");
  if (res.status === 410) return state("Достъпът е изтекъл", "Срокът на тази галерия е изтекъл. Свържи се с фотографа.");
  if (!res.ok) return state("Нещо се обърка", "Опитай отново след малко.", h("button", { class: "btn btn-primary", onclick: () => load() }, "Опитай пак"));
  render(await res.json());
}

// ---------- gallery ----------

function render({ gallery, photos }) {
  document.title = gallery.title;
  const favKey = `pixiset-fav:${gallery.id}`;
  let favorites = new Set(JSON.parse(localStorage.getItem(favKey) || "[]"));
  let activeSet = "ALL";
  let onlyFavorites = false;
  let busyAll = false;

  const saveFavorites = () => localStorage.setItem(favKey, JSON.stringify([...favorites]));
  const setNames = [...new Set([...(gallery.sets || []), ...photos.map((p) => p.setName)])].filter((s) => photos.some((p) => p.setName === s));
  const cover = photos.find((p) => p.id === gallery.coverPhotoId) || photos[0];

  const main = h("main", { class: "gallery-main", id: "photos" });
  const chips = h("div", { class: "set-chips" });
  const actions = h("div", { class: "row" });
  const bar = h("div", { class: "gallery-bar" }, h("div", { class: "inner" }, chips, actions));
  let flat = [];

  const toggleFavorite = (id) => {
    favorites.has(id) ? favorites.delete(id) : favorites.add(id);
    saveFavorites();
    drawBar();
    document.querySelectorAll(`[data-fav="${CSS.escape(id)}"]`).forEach((b) => {
      b.classList.toggle("on", favorites.has(id));
      b.setAttribute("aria-pressed", String(favorites.has(id)));
      b.textContent = favorites.has(id) ? "♥" : "♡";
    });
    if (onlyFavorites) drawGrid();
  };

  async function downloadOne(photo) {
    try {
      const res = await gfetch(`/download?id=${encodeURIComponent(photo.id)}`);
      if (res.status === 403) return toast("Свалянето е изключено за тази галерия.", "error");
      if (!res.ok) throw new Error();
      const { url } = await res.json();
      const a = h("a", { href: url, rel: "noopener" });
      document.body.append(a); a.click(); a.remove();
    } catch {
      toast("Снимката не може да се свали. Опитай пак.", "error");
    }
  }

  async function downloadMany(list, label) {
    if (busyAll || !list.length) return;
    const ok = await ask({ title: label, message: `Ще се свалят ${list.length} файла един след друг. Браузърът може да поиска разрешение за няколко сваляния — разреши го.`, ok: "Свали" });
    if (!ok) return;
    busyAll = true;
    drawBar();
    for (const [i, photo] of list.entries()) {
      toast(`Сваляне ${i + 1} от ${list.length}…`);
      await downloadOne(photo);
      await sleep(700);
    }
    busyAll = false;
    drawBar();
  }

  async function sendSelection() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem("pixiset-contact") || "{}"); } catch { /* ignore */ }
    const values = await ask({
      title: "Изпрати селекция", ok: "Изпрати",
      message: `Избрани снимки: ${favorites.size}. Фотографът ще ги получи заедно с твоето име.`,
      fields: [
        { name: "name", label: "Твоето име", required: true, max: 120, value: saved.name, autocomplete: "name" },
        { name: "email", label: "Имейл", type: "email", required: true, max: 200, value: saved.email, autocomplete: "email" },
        { name: "note", label: "Бележка (по избор)", rows: 3, max: 1000 },
      ],
    });
    if (!values) return;
    localStorage.setItem("pixiset-contact", JSON.stringify({ name: values.name, email: values.email }));
    try {
      const res = await gfetch(`/galleries/${encodeURIComponent(gallery.id)}/selection`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...values, photoIds: [...favorites] }),
      });
      if (!res.ok) throw new Error();
      toast("Селекцията е изпратена. Благодарим!", "success");
    } catch {
      toast("Селекцията не се изпрати. Опитай пак.", "error");
    }
  }

  function drawBar() {
    chips.replaceChildren(...(setNames.length > 1
      ? [["ALL", "Всички"], ...setNames.map((s) => [s, s])].map(([value, label]) =>
        h("button", { class: "btn btn-small", "aria-pressed": String(activeSet === value), onclick: () => { activeSet = value; drawBar(); drawGrid(); } }, label))
      : []));
    const favPhotos = photos.filter((p) => favorites.has(p.id));
    actions.replaceChildren(...[
      h("button", { class: "btn btn-small", "aria-pressed": String(onlyFavorites), onclick: () => { onlyFavorites = !onlyFavorites; drawBar(); drawGrid(); } }, `${onlyFavorites ? "♥" : "♡"} Любими (${favorites.size})`),
      favorites.size ? h("button", { class: "btn btn-small btn-primary", onclick: sendSelection }, "Изпрати селекция") : null,
      gallery.downloadEnabled && favPhotos.length ? h("button", { class: "btn btn-small", disabled: busyAll, onclick: () => downloadMany(favPhotos, "Свали любимите") }, "Свали любимите") : null,
      gallery.downloadEnabled ? h("button", { class: "btn btn-small", disabled: busyAll, onclick: () => downloadMany(photos, "Свали всички снимки") }, "Свали всички") : null,
    ].filter(Boolean));
  }

  function drawGrid() {
    flat = [];
    const groups = setNames.filter((s) => activeSet === "ALL" || s === activeSet);
    const blocks = groups.map((name) => {
      const items = photos.filter((p) => p.setName === name && (!onlyFavorites || favorites.has(p.id)));
      if (!items.length) return null;
      return h("section", {},
        setNames.length > 1 ? h("h2", { class: "set-title" }, name, " ", h("small", {}, `(${items.length})`)) : null,
        h("div", { class: "justified" }, items.map((p) => {
          const index = flat.push(p) - 1;
          const ratio = p.width && p.height ? p.width / p.height : 1.5;
          const on = favorites.has(p.id);
          return h("div", { class: "tile", style: `flex:${(ratio * 100).toFixed(2)} 1 calc(var(--row) * ${ratio.toFixed(4)})` },
            h("button", { class: "open", "aria-label": `Отвори снимка ${p.filename}`, onclick: () => openLightbox(index) },
              h("img", { src: p.url, alt: "", loading: "lazy", decoding: "async", width: p.width || undefined, height: p.height || undefined })),
            h("button", { class: `fav${on ? " on" : ""}`, dataset: { fav: p.id }, "aria-pressed": String(on), "aria-label": "Любима", onclick: () => toggleFavorite(p.id) }, on ? "♥" : "♡"));
        })));
    }).filter(Boolean);
    main.replaceChildren(...(blocks.length ? blocks : [h("p", { class: "empty" }, onlyFavorites ? "Още няма любими. Докосни сърцето на снимка, за да я добавиш." : "В тази галерия още няма снимки.")]));
  }

  // ----- lightbox -----
  const lb = {
    dlg: h("dialog", { class: "lightbox", "aria-label": "Преглед на снимка" }),
    index: 0,
  };
  const lbImg = h("img", { alt: "" });
  const lbCount = h("span", { class: "lb-count", "aria-live": "polite" });
  const lbFav = h("button", { "aria-label": "Любима" });
  const lbDownload = h("button", {}, "Свали");
  const stage = h("div", { class: "lb-stage" }, lbImg);

  const show = (i) => {
    lb.index = (i + flat.length) % flat.length;
    const p = flat[lb.index];
    lbImg.src = p.displayUrl;
    lbImg.alt = p.filename;
    lbCount.textContent = `${lb.index + 1} / ${flat.length}`;
    const on = favorites.has(p.id);
    lbFav.textContent = on ? "♥ Любима" : "♡ Любима";
    lbFav.setAttribute("aria-pressed", String(on));
    lbDownload.hidden = !gallery.downloadEnabled;
    for (const n of [flat[(lb.index + 1) % flat.length], flat[(lb.index - 1 + flat.length) % flat.length]]) new Image().src = n.displayUrl;
  };
  function openLightbox(i) { if (!flat.length) return; show(i); if (!lb.dlg.open) lb.dlg.showModal(); }

  lbFav.onclick = () => { toggleFavorite(flat[lb.index].id); show(lb.index); };
  lbDownload.onclick = () => downloadOne(flat[lb.index]);
  lb.dlg.append(
    h("div", { class: "lb-top" }, lbCount, h("div", { class: "row" }, lbFav, lbDownload, h("button", { "aria-label": "Затвори", onclick: () => lb.dlg.close() }, "✕"))),
    stage,
    h("button", { class: "lb-nav lb-prev", "aria-label": "Предишна", onclick: () => show(lb.index - 1) }, "‹"),
    h("button", { class: "lb-nav lb-next", "aria-label": "Следваща", onclick: () => show(lb.index + 1) }, "›"));
  lb.dlg.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") show(lb.index + 1);
    else if (e.key === "ArrowLeft") show(lb.index - 1);
    else if (e.key.toLowerCase() === "f") { toggleFavorite(flat[lb.index].id); show(lb.index); }
  });
  lb.dlg.addEventListener("click", (e) => { if (e.target === lb.dlg || e.target === stage) lb.dlg.close(); });
  let startX = null;
  stage.addEventListener("pointerdown", (e) => { startX = e.clientX; });
  stage.addEventListener("pointerup", (e) => {
    if (startX !== null && Math.abs(e.clientX - startX) > 50) show(lb.index + (e.clientX < startX ? 1 : -1));
    startX = null;
  });

  // ----- page -----
  const hero = h("header", { class: "hero" },
    cover ? h("img", { src: cover.displayUrl, alt: "", fetchpriority: "high", decoding: "async" }) : null,
    h("div", { class: "hero-copy" },
      h("h1", {}, gallery.title),
      h("p", {}, [gallery.displayDate ? fmtDate(gallery.displayDate) : null, `${photos.length} снимки`].filter(Boolean).join(" · ")),
      gallery.description ? h("p", { style: "text-transform:none;letter-spacing:normal;max-width:560px;margin:0 auto 24px" }, gallery.description) : null,
      h("a", { class: "btn", href: "#photos" }, "Виж галерията")));

  root.replaceChildren(hero, bar, main, lb.dlg);
  drawBar();
  drawGrid();
}

load();
