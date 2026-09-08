import { prisma } from "@/lib/db";
import { gateGallery, clientMeta } from "@/lib/gallery-access";

type Ctx = { params: Promise<{ slug: string }> };

/** Fire-and-forget visit log, called once from the gallery view on mount. */
export async function POST(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  const { gallery, reason, access } = await gateGallery(slug);
  if (!gallery || reason !== "ok" || !access) {
    return new Response(null, { status: 204 });
  }

  const { ip, ua } = await clientMeta();

  // De-dupe: at most one visit row per visitor per 6 hours.
  const recent = await prisma.galleryVisit.findFirst({
    where: {
      galleryId: gallery.id,
      visitorId: access.visitorId,
      createdAt: { gt: new Date(Date.now() - 6 * 3600_000) },
    },
    select: { id: true },
  });
  if (!recent) {
    await prisma.galleryVisit.create({
      data: {
        galleryId: gallery.id,
        visitorId: access.visitorId,
        email: access.email ?? null,
        ip,
        userAgent: ua,
      },
    });
  }

  return Response.json({ ok: true });
}
