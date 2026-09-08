import { prisma } from "@/lib/db";
import { requireAdmin, errorResponse } from "@/lib/admin-guard";
import { galleryCreateSchema } from "@/lib/validation";
import { uniqueSlug } from "@/lib/slug";

export async function GET() {
  try {
    await requireAdmin();
    const galleries = await prisma.gallery.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        _count: {
          select: { photos: true, downloads: true, visits: true, submissions: true },
        },
      },
    });
    return Response.json({ galleries });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const uid = await requireAdmin();
    const body = galleryCreateSchema.parse(await req.json());

    const gallery = await prisma.gallery.create({
      data: {
        title: body.title,
        description: body.description || null,
        slug: uniqueSlug(body.title),
        createdById: uid,
      },
    });

    return Response.json({ gallery }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
