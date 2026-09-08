import { prisma } from "@/lib/db";
import { requireAdmin, errorResponse, HttpError } from "@/lib/admin-guard";
import { deletePhotoObjects } from "@/lib/s3";

type Ctx = { params: Promise<{ id: string; photoId: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { id: galleryId, photoId } = await params;

    const photo = await prisma.photo.findFirst({
      where: { id: photoId, galleryId },
      select: { id: true, keyOriginal: true },
    });
    if (!photo) throw new HttpError(404, "Photo not found");

    await deletePhotoObjects([
      { galleryId, photoId: photo.id, keyOriginal: photo.keyOriginal },
    ]);

    await prisma.photo.delete({ where: { id: photo.id } });

    // Clear the cover if it pointed at this photo.
    await prisma.gallery.updateMany({
      where: { id: galleryId, coverPhotoId: photo.id },
      data: { coverPhotoId: null },
    });

    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
