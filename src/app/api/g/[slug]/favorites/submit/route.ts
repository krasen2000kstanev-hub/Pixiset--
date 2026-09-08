import { prisma } from "@/lib/db";
import { gateGallery } from "@/lib/gallery-access";
import { selectionSubmitSchema } from "@/lib/validation";
import { notifySelection } from "@/lib/mail";
import { emailEnabled } from "@/lib/env";

type Ctx = { params: Promise<{ slug: string }> };

/** Client submits their favorite selection with name + email + optional note. */
export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const { gallery, reason, access } = await gateGallery(slug);
  if (!gallery || reason !== "ok" || !access) {
    return Response.json({ error: reason }, { status: 403 });
  }

  const body = selectionSubmitSchema.parse(await req.json());

  const favorites = await prisma.favorite.findMany({
    where: { galleryId: gallery.id, visitorId: access.visitorId },
    select: { photoId: true },
  });
  if (favorites.length === 0) {
    return Response.json({ error: "no-favorites" }, { status: 400 });
  }
  const photoIds = favorites.map((f) => f.photoId);

  const submission = await prisma.favoriteSubmission.create({
    data: {
      galleryId: gallery.id,
      name: body.name,
      email: body.email.toLowerCase(),
      note: body.note || null,
      photoIds,
    },
  });

  if (emailEnabled() && gallery.notifyOnSelection) {
    try {
      await notifySelection({
        gallery: {
          title: gallery.title,
          slug: gallery.slug,
          notifyEmails: gallery.notifyEmails,
        },
        name: body.name,
        email: body.email,
        note: body.note,
        count: photoIds.length,
      });
    } catch (e) {
      console.error("notifySelection failed", e);
    }
  }

  return Response.json({ ok: true, id: submission.id, count: photoIds.length });
}
