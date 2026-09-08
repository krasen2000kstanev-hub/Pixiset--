import { describe, it, expect } from "vitest";
import { justifiedRows } from "@/lib/justified";

const landscape = { width: 3000, height: 2000 };
const portrait = { width: 2000, height: 3000 };

describe("justifiedRows", () => {
  it("fills each full row to roughly the container width", () => {
    const items = Array.from({ length: 12 }, () => ({ ...landscape }));
    const rows = justifiedRows(items, 1000, 300, 8);
    for (const row of rows.slice(0, -1)) {
      const w =
        row.reduce((s, r) => s + r.width, 0) + 8 * (row.length - 1);
      expect(Math.abs(w - 1000)).toBeLessThan(3);
    }
  });

  it("keeps every item exactly once", () => {
    const items = [landscape, portrait, landscape, portrait, landscape];
    const rows = justifiedRows(items, 800, 250, 8);
    expect(rows.flat().length).toBe(items.length);
  });

  it("does not blow up the last row when it has one wide image", () => {
    const rows = justifiedRows([landscape], 1200, 300, 8);
    expect(rows[0][0].height).toBeLessThanOrEqual(300);
  });
});
