import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.GALLERY_ACCESS_SECRET = "test-secret-value-please-change-1234567890";
});

describe("gallery access tokens", () => {
  it("round-trips a signed token scoped to one gallery", async () => {
    const { signAccess, verifyAccess } = await import("@/lib/access");
    const token = await signAccess({
      galleryId: "gal_1",
      visitorId: "vis_1",
      email: "a@b.com",
    });
    const decoded = await verifyAccess(token, "gal_1");
    expect(decoded).toMatchObject({
      galleryId: "gal_1",
      visitorId: "vis_1",
      email: "a@b.com",
    });
  });

  it("rejects a token for a different gallery", async () => {
    const { signAccess, verifyAccess } = await import("@/lib/access");
    const token = await signAccess({ galleryId: "gal_1", visitorId: "vis_1" });
    expect(await verifyAccess(token, "gal_2")).toBeNull();
  });

  it("returns null for missing/garbage tokens", async () => {
    const { verifyAccess } = await import("@/lib/access");
    expect(await verifyAccess(undefined, "gal_1")).toBeNull();
    expect(await verifyAccess("not-a-jwt", "gal_1")).toBeNull();
  });
});
