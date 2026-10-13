import { describe, expect, it } from "vitest";
import { assertVisible, handler, hashPassword, publicGallery, slugify, validSlug, verifyPassword } from "../lambda/handler.mjs";

const ev = (method: string, path: string, extra: Record<string, unknown> = {}) => ({
  rawPath: path,
  requestContext: { http: { method, path, sourceIp: "203.0.113.9" }, ...(extra.requestContext as object) },
  headers: {},
  ...extra,
});
const asTeam = { authorizer: { jwt: { claims: { sub: "user-1" } } } };

const status = async (event: object) => (await handler(event as never)).statusCode;
const payload = async (event: object) => JSON.parse((await handler(event as never)).body);

describe("slugify / validSlug", () => {
  it("transliterates Bulgarian titles instead of dropping them", () => {
    expect(slugify("Сватба — Иванови")).toBe("svatba-ivanovi");
    expect(slugify("  Hello,   World!  ")).toBe("hello-world");
  });
  it("never ends with a dash after truncation", () => {
    expect(slugify(`${"a".repeat(59)} b`)).not.toMatch(/-$/);
  });
  it("accepts only url-safe slugs", () => {
    expect(validSlug("svatba-ivanovi")).toBe(true);
    expect(validSlug("Bad Slug")).toBe(false);
    expect(validSlug("a")).toBe(false);
    expect(validSlug("-x-")).toBe(false);
  });
});

describe("passwords", () => {
  it("verifies the right password only", () => {
    const hash = hashPassword("s3cret-pass");
    expect(verifyPassword("s3cret-pass", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
    expect(verifyPassword("anything", "")).toBe(false);
  });
});

describe("assertVisible", () => {
  const base = { id: "g", status: "PUBLISHED" };
  it("hides drafts and unknown galleries as not-found", () => {
    expect(() => assertVisible({ ...base, status: "DRAFT" }, undefined)).toThrow("not-found");
    expect(() => assertVisible(undefined, undefined)).toThrow("not-found");
  });
  it("rejects expired galleries only after the expiry day", () => {
    expect(() => assertVisible({ ...base, expiresAt: "2026-01-01" }, undefined, "2026-01-02")).toThrow("expired");
    expect(assertVisible({ ...base, expiresAt: "2026-01-01" }, undefined, "2026-01-01")).toBeTruthy();
  });
  it("requires the gallery password when one is set", () => {
    const passwordHash = hashPassword("open-sesame");
    expect(() => assertVisible({ ...base, passwordHash }, undefined)).toThrow("password-required");
    expect(() => assertVisible({ ...base, passwordHash }, "nope")).toThrow("password-required");
    expect(assertVisible({ ...base, passwordHash }, "open-sesame")).toBeTruthy();
  });
});

describe("publicGallery", () => {
  it("never exposes internal fields", () => {
    const out = publicGallery({ id: "g", slug: "s", title: "T", createdById: "u", passwordHash: "x", status: "PUBLISHED", createdAt: "now" });
    expect(Object.keys(out)).not.toContain("createdById");
    expect(Object.keys(out)).not.toContain("passwordHash");
    expect(out.downloadEnabled).toBe(true);
  });
});

describe("handler routing and validation (no AWS calls)", () => {
  it("answers preflight and version", async () => {
    expect(await status(ev("OPTIONS", "/admin/galleries"))).toBe(200);
    expect((await payload(ev("GET", "/version"))).version).toBe("dev");
  });
  it("404s unknown routes without leaking details", async () => {
    expect(await status(ev("GET", "/nope"))).toBe(404);
  });
  it("rejects team routes without a Cognito subject", async () => {
    expect(await status(ev("GET", "/admin/galleries"))).toBe(401);
  });
  it("requires a photo id for downloads", async () => {
    expect(await status(ev("GET", "/download"))).toBe(400);
  });
  it("returns 400 for malformed JSON bodies", async () => {
    expect(await status(ev("POST", "/admin/galleries", { requestContext: { http: { method: "POST", path: "/admin/galleries" }, ...asTeam }, body: "{oops" }))).toBe(400);
  });
  it("validates gallery patches before touching the database", async () => {
    const patch = (body: object) =>
      status(ev("PATCH", "/admin/galleries/abc", { requestContext: { http: { method: "PATCH", path: "/admin/galleries/abc" }, ...asTeam }, body: JSON.stringify(body) }));
    expect(await patch({ status: "banana" })).toBe(400);
    expect(await patch({ slug: "Bad Slug" })).toBe(400);
    expect(await patch({ displayDate: "tomorrow" })).toBe(400);
    expect(await patch({ password: "x" })).toBe(400);
    expect(await patch({})).toBe(400);
  });
});
