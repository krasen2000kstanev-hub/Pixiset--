import { describe, expect, it } from "vitest";
import { validateUpload } from "../lambda/handler.mjs";

describe("validateUpload", () => {
  it("accepts safe image uploads and strips path components", () => {
    expect(validateUpload({ filename: "..\\wedding.jpg", contentType: "image/jpeg", size: 100 })).toEqual({
      filename: "wedding.jpg",
      contentType: "image/jpeg",
      size: 100,
    });
  });

  it("rejects unsupported types and oversized files", () => {
    expect(validateUpload({ filename: "x.svg", contentType: "image/svg+xml", size: 100 })).toBeNull();
    expect(validateUpload({ filename: "x.jpg", contentType: "image/jpeg", size: 50 * 1024 * 1024 + 1 })).toBeNull();
  });
});
