import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { requireAdmin, errorResponse, HttpError } from "@/lib/admin-guard";
import { uploadRequestSchema } from "@/lib/validation";
import { objectKey, presignUpload } from "@/lib/s3";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Hand the browser presigned PUT URLs for the three renditions of each photo.
 * The browser uploads directly to S3, then calls POST /photos to persist rows.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { id: galleryId } = await params;
    const { files } = uploadRequestSchema.parse(await req.json());

    const gallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      select: { id: true },
    });
    if (!gallery) throw new HttpError(404, "Gallery not found");

    const items = await Promise.all(
      files.map(async (f) => {
        const photoId = newId();
        const ext = f.originalExt.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
        const keyOriginal = objectKey(galleryId, photoId, "original", ext);
        const keyDisplay = objectKey(galleryId, photoId, "display");
        const keyThumb = objectKey(galleryId, photoId, "thumb");

        const [putOriginal, putDisplay, putThumb] = await Promise.all([
          presignUpload(keyOriginal, f.originalType),
          presignUpload(keyDisplay, "image/jpeg"),
          presignUpload(keyThumb, "image/jpeg"),
        ]);

        return {
          clientId: f.clientId,
          photoId,
          keyOriginal,
          keyDisplay,
          keyThumb,
          putOriginal,
          putDisplay,
          putThumb,
        };
      }),
    );

    return Response.json({ items });
  } catch (e) {
    return errorResponse(e);
  }
}
