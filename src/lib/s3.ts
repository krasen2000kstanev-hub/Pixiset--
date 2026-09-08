import {
  S3Client,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireEnv } from "@/lib/env";

const region = process.env.AWS_REGION || "eu-central-1";

export const s3 = new S3Client({ region });

export function bucket(): string {
  return requireEnv("S3_BUCKET");
}

// ---- Key layout ---------------------------------------------------------
// originals/{galleryId}/{photoId}.{ext}      -> private, presigned GET only
// cdn/{galleryId}/{photoId}/display.jpg      -> public-read, cached via CloudFront
// cdn/{galleryId}/{photoId}/thumb.jpg        -> public-read, cached via CloudFront

export type Rendition = "original" | "display" | "thumb";

export function objectKey(
  galleryId: string,
  photoId: string,
  rendition: Rendition,
  ext = "jpg",
): string {
  if (rendition === "original") {
    return `originals/${galleryId}/${photoId}.${ext}`;
  }
  return `cdn/${galleryId}/${photoId}/${rendition}.jpg`;
}

export function publicUrl(key: string): string {
  const base = requireEnv("NEXT_PUBLIC_CDN_URL").replace(/\/$/, "");
  return `${base}/${key}`;
}

/**
 * Presigned PUT for a browser to upload one rendition directly to S3.
 *
 * Only `Content-Type` is signed (the browser sends exactly that header).
 * Cache-Control for `cdn/*` is applied by a CloudFront response-headers policy,
 * not here — adding it to the signed request would force the browser to send a
 * matching header and break the signature.
 */
export async function presignUpload(
  key: string,
  contentType: string,
  expiresIn = 600,
): Promise<string> {
  return getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn },
  );
}

/** Presigned GET for a client to download an original (short-lived). */
export async function presignDownload(
  key: string,
  downloadFilename: string,
  expiresIn = 300,
): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentDisposition: `attachment; filename="${sanitizeFilename(
        downloadFilename,
      )}"`,
    }),
    { expiresIn },
  );
}

/** Delete every rendition of a set of photos. */
export async function deletePhotoObjects(
  entries: { galleryId: string; photoId: string; keyOriginal: string }[],
): Promise<void> {
  if (entries.length === 0) return;
  const Objects = entries.flatMap((e) => [
    { Key: e.keyOriginal },
    { Key: objectKey(e.galleryId, e.photoId, "display") },
    { Key: objectKey(e.galleryId, e.photoId, "thumb") },
  ]);

  // S3 DeleteObjects accepts max 1000 keys per call.
  for (let i = 0; i < Objects.length; i += 1000) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket(),
        Delete: { Objects: Objects.slice(i, i + 1000), Quiet: true },
      }),
    );
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "photo.jpg";
}
