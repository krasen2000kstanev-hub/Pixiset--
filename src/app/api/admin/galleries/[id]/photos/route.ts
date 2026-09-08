import { prisma } from "@/lib/db";
import { requireAdmin, errorResponse, HttpError } from "@/lib/admin-guard";
import { photosConfirmSchema, reorderSchema } from "@/lib/validation";
import { objectKey } from "@/lib/s3";

type Ctx = { params: Promise<{ id: string }> };

/** Persist Photo rows after the browser has uploaded renditions to S3. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { id: galleryId } = await params;
    const { photos } = photosConfirmSchema.parse(await req.json());

    const gallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      select: { id: true, coverPhotoId: true },
    });
    if (!gallery) throw new HttpError(404, "Gallery not found");

    // The browser echoes back the keyOriginal it was handed; make sure it still
    // points inside this gallery's originals prefix.
    const badKey = photos.find(
      (p) => !p.keyOriginal.startsWith(`originals/${galleryId}/`),
    );
    if (badKey) throw new HttpError(400, "Invalid photo key");

    const last = await prisma.photo.aggregate({
      where: { galleryId },
      _max: { sortOrder: true },
    });
    let sortOrder = (last._max.sortOrder ?? -1) + 1;

    await prisma.$transaction(
      photos.map((p) =>
        prisma.photo.create({
          data: {
            id: p.photoId,
            galleryId,
            filename: p.filename,
            keyOriginal: p.keyOriginal,
            keyDisplay: objectKey(galleryId, p.photoId, "display"),
            keyThumb: objectKey(galleryId, p.photoId, "thumb"),
            width: p.width,
            height: p.height,
            bytes: p.bytes,
            sortOrder: sortOrder++,
          },
        }),
      ),
    );

    // If the gallery has no cover yet, use the first uploaded photo.
    if (!gallery.coverPhotoId) {
      await prisma.gallery.update({
        where: { id: galleryId },
        data: { coverPhotoId: photos[0].photoId },
      });
    }

    return Response.json({ ok: true, count: photos.length }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Reorder photos: body { order: [photoId, ...] }. */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { id: galleryId } = await params;
    const { order } = reorderSchema.parse(await req.json());

    await prisma.$transaction(
      order.map((photoId, index) =>
        prisma.photo.updateMany({
          where: { id: photoId, galleryId },
          data: { sortOrder: index },
        }),
      ),
    );

    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
