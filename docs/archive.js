// "Download all" as ZIP, built in the visitor's browser from presigned S3 URLs.
// - Chromium: streams one ZIP straight to a file the visitor picks (no memory pressure).
// - Elsewhere: builds several ZIP parts of at most PART_BYTES each and downloads them in turn.
import { ZipWriter } from "./zip.js";

export const PART_BYTES = 500 * 1024 * 1024;
const PARALLEL_FETCHES = 3;
const RETRIES = 3;

const clean = (s) => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "photo";

/** Unique, folder-aware names inside the archive: "Set/IMG.jpg", "Set/IMG (2).jpg". */
export function archiveNames(files, useFolders) {
  const used = new Set();
  return files.map((f) => {
    const dir = useFolders ? `${clean(f.setName || "Highlights")}/` : "";
    const base = clean(f.filename);
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    let name = `${dir}${stem}${ext}`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${dir}${stem} (${n})${ext}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** Group files into parts of at most `limit` bytes (a single larger file gets its own part). */
export function planParts(files, limit = PART_BYTES) {
  const parts = [];
  let current = [];
  let bytes = 0;
  for (const f of files) {
    const size = Number(f.size) || 0;
    if (current.length && bytes + size > limit) {
      parts.push(current);
      current = [];
      bytes = 0;
    }
    current.push(f);
    bytes += size;
  }
  if (current.length) parts.push(current);
  return parts;
}

async function fetchBytes(url, signal) {
  let lastError;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastError;
}

/** Yields file contents in order while keeping a few downloads in flight. */
async function* prefetch(files, signal) {
  const queue = [];
  let next = 0;
  const fill = () => {
    while (next < files.length && queue.length < PARALLEL_FETCHES) {
      const file = files[next++];
      const promise = fetchBytes(file.url, signal);
      promise.catch(() => {}); // surfaced when awaited below
      queue.push({ file, promise });
    }
  };
  fill();
  while (queue.length) {
    const { file, promise } = queue.shift();
    const data = await promise;
    fill();
    yield { file, data };
  }
}

const saveBlob = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

/**
 * Must be called straight from a user gesture. `getFiles()` resolves to
 * [{filename, setName, size, url}] once the signed URLs are known.
 * Returns {parts, files}. Throws AbortError when cancelled.
 */
export async function downloadArchive({ name, getFiles, signal, onProgress, partBytes = PART_BYTES }) {
  const stem = clean(name).slice(0, 80);
  let handle = null;
  if (typeof window.showSaveFilePicker === "function") {
    // The picker needs the click's user activation, so open it before any network wait.
    handle = await window.showSaveFilePicker({ suggestedName: `${stem}.zip`, types: [{ description: "ZIP архив", accept: { "application/zip": [".zip"] } }] });
  }

  const files = await getFiles();
  const names = archiveNames(files, new Set(files.map((f) => f.setName)).size > 1);
  const total = files.reduce((n, f) => n + (Number(f.size) || 0), 0);
  let done = 0;
  let bytes = 0;
  const report = (part, parts) => onProgress?.({ done, count: files.length, bytes, total, part, parts });

  const groups = handle ? [files] : planParts(files, partBytes);
  let index = 0;
  for (const [p, group] of groups.entries()) {
    const chunks = [];
    const writable = handle ? await handle.createWritable() : null;
    const zip = new ZipWriter(async (chunk) => { if (writable) await writable.write(chunk); else chunks.push(chunk); });
    try {
      for await (const { data } of prefetch(group, signal)) {
        await zip.addFile(names[index++], data);
        done += 1;
        bytes += data.length;
        report(p + 1, groups.length);
      }
      await zip.close();
      if (writable) await writable.close();
    } catch (error) {
      if (writable) await writable.abort().catch(() => {});
      throw error;
    }
    if (!handle) saveBlob(new Blob(chunks, { type: "application/zip" }), groups.length > 1 ? `${stem}-част-${p + 1}-от-${groups.length}.zip` : `${stem}.zip`);
  }
  return { parts: groups.length, files: files.length };
}
