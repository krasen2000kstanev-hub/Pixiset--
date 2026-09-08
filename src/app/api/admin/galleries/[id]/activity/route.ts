import { prisma } from "@/lib/db";
import { requireAdmin, errorResponse, HttpError } from "@/lib/admin-guard";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET .../activity            -> JSON summary + recent events
 * GET .../activity?export=downloads -> downloads CSV
 * GET .../activity?export=selection&sid=<submissionId> -> filename list (txt)
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { id } = await params;
    const url = new URL(req.url);
    const exportKind = url.searchParams.get("export");

    const gallery = await prisma.gallery.findUnique({
      where: { id },
      select: { id: true, title: true, slug: true },
    });
    if (!gallery) throw new HttpError(404, "Not found");

    if (exportKind === "downloads") {
      const rows = await prisma.downloadEvent.findMany({
        where: { galleryId: id },
        orderBy: { createdAt: "desc" },
        include: { photo: { select: { filename: true } } },
      });
      const header = ["when", "type", "photo", "email", "ip", "userAgent"];
      const csv = [
        header.join(","),
        ...rows.map((r) =>
          [
            r.createdAt.toISOString(),
            r.type,
            r.photo?.filename ?? (r.type === "BULK" ? "(all photos)" : ""),
            r.email ?? "",
            r.ip ?? "",
            r.userAgent ?? "",
          ]
            .map(csvCell)
            .join(","),
        ),
      ].join("\r\n");

      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${gallery.slug}-downloads.csv"`,
        },
      });
    }

    if (exportKind === "selection") {
      const sid = url.searchParams.get("sid");
      const sub = sid
        ? await prisma.favoriteSubmission.findFirst({
            where: { id: sid, galleryId: id },
          })
        : null;
      if (!sub) throw new HttpError(404, "Submission not found");

      const photos = await prisma.photo.findMany({
        where: { id: { in: sub.photoIds } },
        select: { filename: true },
      });
      const body =
        `# Selection from ${sub.name} <${sub.email}> — ${sub.createdAt.toISOString()}\n` +
        (sub.note ? `# Note: ${sub.note}\n` : "") +
        photos.map((p) => p.filename).join("\n") +
        "\n";

      return new Response(body, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "content-disposition": `attachment; filename="${gallery.slug}-selection.txt"`,
        },
      });
    }

    const [visits, downloads, submissions, counts] = await Promise.all([
      prisma.galleryVisit.findMany({
        where: { galleryId: id },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      prisma.downloadEvent.findMany({
        where: { galleryId: id },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: { photo: { select: { filename: true } } },
      }),
      prisma.favoriteSubmission.findMany({
        where: { galleryId: id },
        orderBy: { createdAt: "desc" },
      }),
      prisma.$transaction([
        prisma.galleryVisit.count({ where: { galleryId: id } }),
        prisma.downloadEvent.count({ where: { galleryId: id } }),
        prisma.favorite.count({ where: { galleryId: id } }),
      ]),
    ]);

    return Response.json({
      gallery,
      totals: {
        visits: counts[0],
        downloads: counts[1],
        favorites: counts[2],
        submissions: submissions.length,
      },
      visits,
      downloads,
      submissions,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
