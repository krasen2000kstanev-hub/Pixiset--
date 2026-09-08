import { prisma } from "@/lib/db";
import { gateGallery, clientMeta } from "@/lib/gallery-access";
import { downloadSchema } from "@/lib/validation";
import { presignDownload } from "@/lib/s3";
import { notifyBulkDownload } from "@/lib/mail";
import { emailEnabled } from "@/lib/env";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * POST body:
 *   { photoId }  -> one presigned download URL, logs a SINGLE event
 *   { all: true } -> list of presigned URLs, logs one BULK event
 */
export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const { gallery, reason, access } = await gateGallery(slug);
  if (!gallery || reason !== "ok" || !access) {
    return Response.json({ error: reason }, { status: 403 });
  }
  if (!gallery.downloadEnabled) {
    return Response.json({ error: "downloads-disabled" }, { status: 403 });
  }

  const body = downloadSchema.parse(await req.json());
  const { ip, ua } = await clientMeta();
  const web = gallery.downloadSize === "WEB";

  const urlFor = async (p: {
    id: string;
    filename: string;
    keyOriginal: string;
    keyDisplay: string;
  }) =>
    // Presigned in both cases so S3 forces a file download (Content-Disposition)
    // rather than opening the image in a tab.
    web
      ? presignDownload(p.keyDisplay, webFilename(p.filename))
      : presignDownload(p.keyOriginal, p.filename);

  if ("all" in body) {
    const photos = await prisma.photo.findMany({
      where: { galleryId: gallery.id },
      orderBy: { sortOrder: "asc" },
    });
    if (photos.length === 0) {
      return Response.json({ error: "empty" }, { status: 400 });
    }

    await prisma.downloadEvent.create({
      data: {
        galleryId: gallery.id,
        type: "BULK",
        visitorId: access.visitorId,
        email: access.email ?? null,
        ip,
        userAgent: ua,
      },
    });

    if (emailEnabled() && gallery.notifyOnBulkDownload) {
      try {
        await notifyBulkDownload({
          gallery: {
            title: gallery.title,
            slug: gallery.slug,
            notifyEmails: gallery.notifyEmails,
          },
          email: access.email,
          ip,
          count: photos.length,
        });
      } catch (e) {
        console.error("notifyBulkDownload failed", e);
      }
    }

    const files = await Promise.all(
      photos.map(async (p) => ({
        filename: p.filename,
        url: await urlFor(p),
      })),
    );
    return Response.json({ files });
  }

  const photo = await prisma.photo.findFirst({
    where: { id: body.photoId, galleryId: gallery.id },
  });
  if (!photo) return Response.json({ error: "not-found" }, { status: 404 });

  await prisma.downloadEvent.create({
    data: {
      galleryId: gallery.id,
      photoId: photo.id,
      type: "SINGLE",
      visitorId: access.visitorId,
      email: access.email ?? null,
      ip,
      userAgent: ua,
    },
  });

  return Response.json({ filename: photo.filename, url: await urlFor(photo) });
}

/** For web-size downloads, tag the filename so it isn't confused with the original. */
function webFilename(name: string): string {
  return name.replace(/(\.[a-z0-9]+)?$/i, "-web.jpg");
}
