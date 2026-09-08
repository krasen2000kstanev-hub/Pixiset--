"use client";

import type { Renditions } from "@/lib/image-client";

export interface UploadProgress {
  total: number;
  done: number;
  failed: number;
  phase: "processing" | "done";
}

interface UploadArgs {
  galleryId: string;
  files: File[];
  makeRenditions: (f: File) => Promise<Renditions>;
  onProgress: (p: UploadProgress) => void;
}

interface PresignItem {
  clientId: string;
  photoId: string;
  keyOriginal: string;
  putOriginal: string;
  putDisplay: string;
  putThumb: string;
}

const CONCURRENCY = 4;

/**
 * Full client-side upload:
 *  1. resize each file in the browser (thumb + display renditions)
 *  2. ask the server for presigned PUT URLs
 *  3. PUT all three renditions straight to S3
 *  4. confirm with the server so Photo rows get created
 */
export async function uploadGallery({
  galleryId,
  files,
  makeRenditions,
  onProgress,
}: UploadArgs): Promise<void> {
  const progress: UploadProgress = {
    total: files.length,
    done: 0,
    failed: 0,
    phase: "processing",
  };

  // Step 1 + 2: process files and request presign URLs in one batch.
  const prepared: {
    clientId: string;
    file: File;
    renditions: Renditions;
  }[] = [];

  for (let i = 0; i < files.length; i++) {
    try {
      const renditions = await makeRenditions(files[i]);
      prepared.push({ clientId: String(i), file: files[i], renditions });
    } catch {
      progress.failed++;
      onProgress({ ...progress });
    }
  }

  if (prepared.length === 0) {
    onProgress({ ...progress, phase: "done" });
    return;
  }

  const presignRes = await fetch(
    `/api/admin/galleries/${galleryId}/upload`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        files: prepared.map((p) => ({
          clientId: p.clientId,
          originalExt: p.renditions.originalExt,
          originalType: p.renditions.originalType,
        })),
      }),
    },
  );
  if (!presignRes.ok) throw new Error("Failed to get upload URLs");
  const { items } = (await presignRes.json()) as { items: PresignItem[] };
  const byClient = new Map(items.map((it) => [it.clientId, it]));

  // Step 3: PUT renditions to S3, bounded concurrency.
  const confirmed: {
    photoId: string;
    filename: string;
    keyOriginal: string;
    width: number;
    height: number;
    bytes: number;
  }[] = [];

  let cursor = 0;
  async function worker() {
    while (cursor < prepared.length) {
      const idx = cursor++;
      const p = prepared[idx];
      const it = byClient.get(p.clientId);
      if (!it) {
        progress.failed++;
        onProgress({ ...progress });
        continue;
      }
      try {
        await Promise.all([
          put(it.putOriginal, p.file, p.renditions.originalType),
          put(it.putDisplay, p.renditions.display, "image/jpeg"),
          put(it.putThumb, p.renditions.thumb, "image/jpeg"),
        ]);
        confirmed.push({
          photoId: it.photoId,
          filename: p.file.name,
          keyOriginal: it.keyOriginal,
          width: p.renditions.width,
          height: p.renditions.height,
          bytes: p.file.size,
        });
      } catch {
        progress.failed++;
      }
      progress.done++;
      onProgress({ ...progress });
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, prepared.length) }, worker),
  );

  // Step 4: persist rows.
  if (confirmed.length > 0) {
    await fetch(`/api/admin/galleries/${galleryId}/photos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ photos: confirmed }),
    });
  }

  onProgress({ ...progress, phase: "done" });
}

async function put(url: string, body: Blob, contentType: string): Promise<void> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "content-type": contentType },
    body,
  });
  if (!res.ok) throw new Error(`S3 PUT failed: ${res.status}`);
}
