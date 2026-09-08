import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { galleryAuthSchema } from "@/lib/validation";
import { verifyPassword } from "@/lib/password";
import {
  signAccess,
  verifyAccess,
  accessCookieName,
  ACCESS_TTL_SECONDS,
} from "@/lib/access";
import { newId } from "@/lib/ids";

type Ctx = { params: Promise<{ slug: string }> };

/** Verify password / collect email, then set the gallery access cookie. */
export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const body = galleryAuthSchema.parse(await req.json().catch(() => ({})));

  const gallery = await prisma.gallery.findUnique({ where: { slug } });
  if (!gallery || gallery.status !== "PUBLISHED") {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  if (gallery.expiresAt && gallery.expiresAt.getTime() < Date.now()) {
    return Response.json({ error: "expired" }, { status: 410 });
  }

  const jar = await cookies();
  const existing = await verifyAccess(
    jar.get(accessCookieName(gallery.id))?.value,
    gallery.id,
  );

  if (gallery.passwordHash && !existing) {
    const ok =
      !!body.password &&
      (await verifyPassword(body.password, gallery.passwordHash));
    if (!ok) {
      return Response.json({ error: "bad-password" }, { status: 401 });
    }
  }

  const email = body.email?.trim().toLowerCase() || existing?.email;
  if (gallery.requireEmail && !email) {
    return Response.json({ error: "email-required" }, { status: 400 });
  }

  const visitorId = existing?.visitorId || newId();
  const token = await signAccess({ galleryId: gallery.id, visitorId, email });

  jar.set(accessCookieName(gallery.id), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_TTL_SECONDS,
  });

  return Response.json({ ok: true });
}
