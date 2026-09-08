import { prisma } from "@/lib/db";
import { requireAdmin, errorResponse, HttpError } from "@/lib/admin-guard";
import { gallerySettingsSchema } from "@/lib/validation";
import { hashPassword } from "@/lib/password";
import { deletePhotoObjects } from "@/lib/s3";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { id } = await params;
    const gallery = await prisma.gallery.findUnique({
      where: { id },
      include: { photos: { orderBy: { sortOrder: "asc" } } },
    });
    if (!gallery) throw new HttpError(404, "Not found");
    return Response.json({ gallery });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { id } = await params;
    const input = gallerySettingsSchema.parse(await req.json());

    const data: Record<string, unknown> = {};
    for (const k of [
      "title",
      "status",
      "coverPhotoId",
      "coverLayout",
      "accentColor",
      "requireEmail",
      "downloadEnabled",
      "downloadSize",
      "notifyOnSelection",
      "notifyOnBulkDownload",
      "notifyEmails",
    ] as const) {
      if (input[k] !== undefined) data[k] = input[k];
    }
    if (input.description !== undefined) data.description = input.description || null;
    if (input.expiresAt !== undefined) {
      data.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    }
    if (input.password !== undefined) {
      data.passwordHash =
        input.password === null || input.password === ""
          ? null
          : await hashPassword(input.password);
    }

    const gallery = await prisma.gallery.update({ where: { id }, data });
    return Response.json({ gallery });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { id } = await params;

    const photos = await prisma.photo.findMany({
      where: { galleryId: id },
      select: { id: true, keyOriginal: true },
    });

    await deletePhotoObjects(
      photos.map((p) => ({
        galleryId: id,
        photoId: p.id,
        keyOriginal: p.keyOriginal,
      })),
    );

    await prisma.gallery.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
