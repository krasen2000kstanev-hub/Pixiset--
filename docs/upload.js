// Browser-side photo pipeline: validate, resize (thumb + display), upload the
// three renditions straight to S3 with presigned URLs, then confirm with the API.

const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 50 * 1024 * 1024;
const THUMB = { edge: 640, quality: 0.8 };
const DISPLAY = { edge: 2048, quality: 0.85 };

/** Split picked files into uploadable and rejected (with a human reason). */
export function checkFiles(files) {
  const accepted = [];
  const rejected = [];
  for (const file of files) {
    if (/\.(heic|heif)$/i.test(file.name) || /hei[cf]/i.test(file.type)) rejected.push({ file, reason: "HEIC не се поддържа — експортирай като JPEG" });
    else if (!TYPES.has(file.type)) rejected.push({ file, reason: "Приемат се само JPEG, PNG и WebP" });
    else if (file.size > MAX_BYTES) rejected.push({ file, reason: "Над 50 MB" });
    else accepted.push(file);
  }
  accepted.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { accepted, rejected };
}

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return createImageBitmap(file);
  }
}

function encode(bitmap, { edge, quality }) {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#fff"; // JPEG has no alpha: avoid black backgrounds for PNG/WebP
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Снимката не може да се обработи"))), "image/jpeg", quality));
}

export async function makeRenditions(file) {
  const bitmap = await decode(file);
  try {
    return { width: bitmap.width, height: bitmap.height, thumb: await encode(bitmap, THUMB), display: await encode(bitmap, DISPLAY) };
  } finally {
    bitmap.close?.();
  }
}

async function put(url, body, contentType, signal) {
  const res = await fetch(url, { method: "PUT", headers: { "content-type": contentType }, body, signal });
  if (!res.ok) throw new Error(`Качването е неуспешно (${res.status})`);
}

/**
 * Upload files with bounded concurrency. `api(path, {method, body})` is the
 * authenticated admin client. Calls onUpdate(items) whenever any item changes.
 * Returns the items; failed ones carry `error` so the UI can offer a retry.
 */
export async function uploadPhotos({ files, galleryId, setName, api, signal, onUpdate, concurrency = 3 }) {
  const base = Date.now();
  const items = files.map((file, index) => ({ file, index, status: "wait", error: null }));
  let cursor = 0;

  async function worker() {
    while (cursor < items.length && !signal?.aborted) {
      const item = items[cursor++];
      item.status = "work";
      onUpdate(items);
      try {
        const { file } = item;
        const r = await makeRenditions(file);
        const up = await api(`/admin/galleries/${galleryId}/upload`, { method: "POST", body: { filename: file.name, contentType: file.type, size: file.size } });
        await Promise.all([
          put(up.urls.original, file, file.type, signal),
          put(up.urls.display, r.display, "image/jpeg", signal),
          put(up.urls.thumb, r.thumb, "image/jpeg", signal),
        ]);
        await api(`/admin/galleries/${galleryId}/photos`, {
          method: "POST",
          body: { photoId: up.photoId, filename: file.name, contentType: file.type, size: file.size, width: r.width, height: r.height, setName, sortOrder: base + item.index },
        });
        item.status = "done";
      } catch (error) {
        item.status = signal?.aborted ? "cancelled" : "error";
        item.error = error.message || "Грешка";
      }
      onUpdate(items);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  for (const item of items) if (item.status === "wait") item.status = "cancelled";
  onUpdate(items);
  return items;
}

/**
 * Prepare photos from the first app version (no display size, sometimes no thumbnail): fetch each
 * original, make thumb + display in the browser, PUT both and let the API record them. This also
 * fills width/height. Returns the items like uploadPhotos(); failed ones carry `error`.
 */
export async function upgradePhotos({ photos, api, signal, onUpdate, concurrency = 2 }) {
  const items = photos.map((photo, index) => ({ photo, index, status: "wait", error: null }));
  let cursor = 0;

  async function worker() {
    while (cursor < items.length && !signal?.aborted) {
      const item = items[cursor++];
      item.status = "work";
      onUpdate(items);
      try {
        const job = await api(`/admin/photos/${item.photo.id}/renditions`, { method: "POST", body: {} });
        const res = await fetch(job.original, { signal });
        if (!res.ok) throw new Error(`Оригиналът не се чете (${res.status})`);
        const blob = await res.blob();
        const r = await makeRenditions(new File([blob], item.photo.filename, { type: blob.type || "image/jpeg" }));
        await Promise.all([put(job.urls.display, r.display, "image/jpeg", signal), put(job.urls.thumb, r.thumb, "image/jpeg", signal)]);
        await api(`/admin/photos/${item.photo.id}`, { method: "PATCH", body: { renditions: true, width: r.width, height: r.height } });
        item.status = "done";
      } catch (error) {
        item.status = signal?.aborted ? "cancelled" : "error";
        item.error = error.message || "Грешка";
      }
      onUpdate(items);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  for (const item of items) if (item.status === "wait") item.status = "cancelled";
  onUpdate(items);
  return items;
}
