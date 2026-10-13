import { describe, expect, it } from "vitest";
import { crc32, ZipWriter } from "../docs/zip.js";
import { archiveNames, planParts } from "../docs/archive.js";

const bytes = (s: string) => new TextEncoder().encode(s);

/** Independent reader: walks the central directory like unzip does and validates every entry. */
function readZip(buf: Uint8Array) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("no end of central directory");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const files: Record<string, { data: Uint8Array; crcOk: boolean; flags: number }> = {};
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("bad central header");
    const flags = v.getUint16(p + 8, true);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const offset = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    if (v.getUint32(offset, true) !== 0x04034b50) throw new Error("bad local header");
    const localNameLen = v.getUint16(offset + 26, true);
    const start = offset + 30 + localNameLen;
    const data = buf.subarray(start, start + size);
    // the data descriptor right after the data must agree with the central directory
    const descriptorOk = v.getUint32(start + size, true) === 0x08074b50 && v.getUint32(start + size + 4, true) === crc && v.getUint32(start + size + 8, true) === size;
    files[name] = { data, crcOk: crc32(data) === crc && descriptorOk, flags };
    p += 46 + nameLen;
  }
  return { count, files };
}

async function build(entries: [string, Uint8Array][]) {
  const chunks: Uint8Array[] = [];
  const zip = new ZipWriter((c: Uint8Array) => { chunks.push(c); });
  for (const [name, data] of entries) await zip.addFile(name, data, new Date(2026, 8, 12, 14, 30, 10));
  await zip.close();
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
  it("can be computed incrementally", () => {
    const whole = crc32(bytes("hello world"));
    expect(crc32(bytes(" world"), crc32(bytes("hello")))).toBe(whole);
  });
});

describe("ZipWriter", () => {
  it("writes a readable archive with correct names, content and CRCs", async () => {
    const big = new Uint8Array(100_000).map((_, i) => (i * 31) % 251);
    const zip = readZip(await build([["Церемония/IMG 1.jpg", bytes("first")], ["b.jpg", big], ["empty.txt", new Uint8Array(0)]]));
    expect(zip.count).toBe(3);
    expect(Object.keys(zip.files)).toEqual(["Церемония/IMG 1.jpg", "b.jpg", "empty.txt"]);
    expect(new TextDecoder().decode(zip.files["Церемония/IMG 1.jpg"].data)).toBe("first");
    expect(Array.from(zip.files["b.jpg"].data)).toEqual(Array.from(big));
    for (const f of Object.values(zip.files)) {
      expect(f.crcOk).toBe(true);
      expect(f.flags & 0x0800).toBe(0x0800); // UTF-8 names
    }
  });

  it("produces a valid empty archive", async () => {
    expect(readZip(await build([])).count).toBe(0);
  });
});

describe("archiveNames", () => {
  it("keeps names flat for one set and uses folders for several", () => {
    const files = [{ filename: "a.jpg", setName: "X" }, { filename: "b.jpg", setName: "Y" }];
    expect(archiveNames(files, false)).toEqual(["a.jpg", "b.jpg"]);
    expect(archiveNames(files, true)).toEqual(["X/a.jpg", "Y/b.jpg"]);
  });
  it("de-duplicates case-insensitively and strips path characters", () => {
    const names = archiveNames([{ filename: "IMG.jpg" }, { filename: "img.JPG" }, { filename: "a/b:c.jpg" }], false);
    expect(names).toEqual(["IMG.jpg", "img (2).JPG", "a_b_c.jpg"]);
  });
});

describe("planParts", () => {
  const f = (size: number) => ({ size });
  it("keeps everything together when it fits", () => {
    expect(planParts([f(10), f(20)], 100)).toHaveLength(1);
  });
  it("splits by size and never produces an empty part", () => {
    const parts = planParts([f(60), f(60), f(60)], 100);
    expect(parts.map((p) => p.length)).toEqual([1, 1, 1]);
    expect(planParts([f(500)], 100)).toHaveLength(1); // oversized single file gets its own part
    expect(planParts([], 100)).toEqual([]);
  });
});
