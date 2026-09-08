import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.S3_BUCKET = "test-bucket";
  process.env.NEXT_PUBLIC_CDN_URL = "https://cdn.example.com/";
  process.env.AWS_REGION = "eu-central-1";
});

describe("objectKey", () => {
  it("keeps originals private under originals/", async () => {
    const { objectKey } = await import("@/lib/s3");
    expect(objectKey("g1", "p1", "original", "cr2")).toBe(
      "originals/g1/p1.cr2",
    );
  });

  it("puts renditions under cdn/", async () => {
    const { objectKey } = await import("@/lib/s3");
    expect(objectKey("g1", "p1", "display")).toBe("cdn/g1/p1/display.jpg");
    expect(objectKey("g1", "p1", "thumb")).toBe("cdn/g1/p1/thumb.jpg");
  });
});

describe("publicUrl", () => {
  it("joins the CDN base and key without a double slash", async () => {
    const { publicUrl } = await import("@/lib/s3");
    expect(publicUrl("cdn/g1/p1/thumb.jpg")).toBe(
      "https://cdn.example.com/cdn/g1/p1/thumb.jpg",
    );
  });
});
