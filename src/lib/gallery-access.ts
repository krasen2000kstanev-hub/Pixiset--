import { cookies, headers } from "next/headers";
import type { Gallery } from "@prisma/client";
import { prisma } from "@/lib/db";
import { accessCookieName, verifyAccess, type GalleryAccess } from "@/lib/access";

export type GateReason =
  | "not-found"
  | "draft"
  | "expired"
  | "password"
  | "email"
  | "ok";

export interface GateResult {
  gallery: Gallery | null;
  reason: GateReason;
  access: GalleryAccess | null;
}

/**
 * Resolve whether the current visitor may see a gallery's photos.
 * Used by both the client gallery pages and the `/api/g/*` routes.
 */
export async function gateGallery(slug: string): Promise<GateResult> {
  const gallery = await prisma.gallery.findUnique({ where: { slug } });
  if (!gallery) return { gallery: null, reason: "not-found", access: null };

  if (gallery.status !== "PUBLISHED") {
    return { gallery, reason: "draft", access: null };
  }
  if (gallery.expiresAt && gallery.expiresAt.getTime() < Date.now()) {
    return { gallery, reason: "expired", access: null };
  }

  const jar = await cookies();
  const token = jar.get(accessCookieName(gallery.id))?.value;
  const access = await verifyAccess(token, gallery.id);

  if (gallery.passwordHash && !access) {
    return { gallery, reason: "password", access: null };
  }
  if (gallery.requireEmail && (!access || !access.email)) {
    return { gallery, reason: access ? "email" : "password", access };
  }

  return { gallery, reason: "ok", access };
}

export async function clientMeta(): Promise<{ ip: string | null; ua: string | null }> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    null;
  return { ip, ua: h.get("user-agent") };
}
