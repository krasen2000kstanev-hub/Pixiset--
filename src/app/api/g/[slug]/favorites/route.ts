import { prisma } from "@/lib/db";
import { gateGallery } from "@/lib/gallery-access";
import { favoriteToggleSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ slug: string }> };

/** Toggle a favorite for the current visitor. Returns the new favorite id list. */
export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const { gallery, reason, access } = await gateGallery(slug);
  if (!gallery || reason !== "ok" || !access) {
    return Response.json({ error: reason }, { status: 403 });
  }

  const { photoId } = favoriteToggleSchema.parse(await req.json());

  const photo = await prisma.photo.findFirst({
    where: { id: photoId, galleryId: gallery.id },
    select: { id: true },
  });
  if (!photo) return Response.json({ error: "not-found" }, { status: 404 });

  const key = {
    galleryId_photoId_visitorId: {
      galleryId: gallery.id,
      photoId,
      visitorId: access.visitorId,
    },
  };

  const existing = await prisma.favorite.findUnique({ where: key });
  if (existing) {
    await prisma.favorite.delete({ where: key });
  } else {
    await prisma.favorite.create({
      data: { galleryId: gallery.id, photoId, visitorId: access.visitorId },
    });
  }

  const favorites = await prisma.favorite.findMany({
    where: { galleryId: gallery.id, visitorId: access.visitorId },
    select: { photoId: true },
  });

  return Response.json({
    favorited: !existing,
    photoIds: favorites.map((f) => f.photoId),
  });
}
