import { SignJWT, jwtVerify } from "jose";

/**
 * Client gallery access tokens.
 *
 * A visitor who clears the password / email gate for a gallery gets a signed
 * cookie `ga_<galleryId>` carrying their random visitorId and (optionally) the
 * email they supplied. The token is scoped to a single gallery.
 */

const SECRET = new TextEncoder().encode(
  process.env.GALLERY_ACCESS_SECRET || "dev-only-insecure-gallery-secret",
);
const ISSUER = "client-gallery";
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface GalleryAccess {
  galleryId: string;
  visitorId: string;
  email?: string;
}

export function accessCookieName(galleryId: string): string {
  return `ga_${galleryId}`;
}

export async function signAccess(a: GalleryAccess): Promise<string> {
  return new SignJWT({ visitorId: a.visitorId, email: a.email ?? null })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setSubject(a.galleryId)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(SECRET);
}

export async function verifyAccess(
  token: string | undefined,
  galleryId: string,
): Promise<GalleryAccess | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET, {
      issuer: ISSUER,
      subject: galleryId,
    });
    if (typeof payload.visitorId !== "string") return null;
    return {
      galleryId,
      visitorId: payload.visitorId,
      email:
        typeof payload.email === "string" && payload.email
          ? payload.email
          : undefined,
    };
  } catch {
    return null;
  }
}

export const ACCESS_TTL_SECONDS = TTL_SECONDS;
