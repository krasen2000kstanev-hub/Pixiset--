"use client";

/** Start a browser download for one presigned URL. */
export function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Download every file sequentially. For very large galleries this is slower
 * than a server-built ZIP (see Phase 2 in the README) but needs no server
 * compute and works everywhere.
 */
export async function downloadAll(
  files: { url: string; filename: string }[],
): Promise<void> {
  for (const f of files) {
    triggerDownload(f.url, f.filename);
    await new Promise((r) => setTimeout(r, 400));
  }
}
