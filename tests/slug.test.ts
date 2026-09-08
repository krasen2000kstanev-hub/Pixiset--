import { describe, it, expect } from "vitest";
import { slugify, uniqueSlug } from "@/lib/slug";

describe("slugify", () => {
  it("lowercases and dashes", () => {
    expect(slugify("Smith Wedding 2026")).toBe("smith-wedding-2026");
  });

  it("transliterates Cyrillic", () => {
    expect(slugify("Сватба на Иван")).toBe("svatba-na-ivan");
  });

  it("strips punctuation and collapses dashes", () => {
    expect(slugify("A — B / C!!")).toBe("a-b-c");
  });

  it("caps length", () => {
    expect(slugify("x".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe("uniqueSlug", () => {
  it("appends a random suffix", () => {
    const s = uniqueSlug("Test Gallery");
    expect(s).toMatch(/^test-gallery-[0-9a-z]{6}$/);
  });

  it("never produces an empty base", () => {
    expect(uniqueSlug("!!!")).toMatch(/^gallery-[0-9a-z]{6}$/);
  });
});
