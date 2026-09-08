"use client";

/**
 * Browser-side image resizing. We never send full-resolution files through the
 * app server: the browser produces `thumb` and `display` JPEGs with a canvas,
 * and uploads all three renditions straight to S3 via presigned URLs.
 */

export interface Renditions {
  original: Blob;
  originalType: string;
  originalExt: string;
  display: Blob;
  thumb: Blob;
  width: number;
  height: number;
}

const DISPLAY_MAX = 2560;
const THUMB_MAX = 600;
const DISPLAY_QUALITY = 0.85;
const THUMB_QUALITY = 0.8;

export async function makeRenditions(file: File): Promise<Renditions> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  const { width, height } = bitmap;

  const display = await encode(bitmap, DISPLAY_MAX, DISPLAY_QUALITY);
  const thumb = await encode(bitmap, THUMB_MAX, THUMB_QUALITY);
  bitmap.close();

  return {
    original: file,
    originalType: file.type || "application/octet-stream",
    originalExt: extFromName(file.name),
    display,
    thumb,
    width,
    height,
  };
}

async function encode(
  bitmap: ImageBitmap,
  maxEdge: number,
  quality: number,
): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      quality,
    );
  });
}

function extFromName(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  const ext = (m?.[1] || "jpg").toLowerCase();
  return ext === "jpeg" ? "jpg" : ext;
}
