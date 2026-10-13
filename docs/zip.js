// Minimal streaming ZIP writer ("store" method, no compression: photos are already compressed).
// Entries use a data descriptor, so file sizes and CRCs are not needed up front.
// No ZIP64: callers keep each archive well under 4 GB and 65 535 entries (see archive.js).

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Incremental CRC-32: pass the previous result as `crc` to continue over another chunk. */
export function crc32(bytes, crc = 0) {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();
const LIMIT = 0xffffffff;

function dosDateTime(date) {
  const d = new Date(date);
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export class ZipWriter {
  /** @param {(chunk: Uint8Array) => Promise<void>|void} write receives the archive bytes in order */
  constructor(write) {
    this.write = write;
    this.offset = 0;
    this.entries = [];
  }

  async #emit(bytes) {
    await this.write(bytes);
    this.offset += bytes.length;
    if (this.offset > LIMIT) throw new Error("ZIP too large");
  }

  /** Add one file whose complete content is in memory. */
  async addFile(name, data, modified = new Date()) {
    if (this.entries.length >= 0xffff) throw new Error("Too many files in one ZIP");
    const nameBytes = encoder.encode(name);
    const { time, date } = dosDateTime(modified);
    const offset = this.offset;

    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true); // version needed
    header.setUint16(6, 0x0808, true); // bit 3: data descriptor, bit 11: UTF-8 names
    header.setUint16(8, 0, true); // method: store
    header.setUint16(10, time, true);
    header.setUint16(12, date, true);
    header.setUint16(26, nameBytes.length, true);
    await this.#emit(new Uint8Array(header.buffer));
    await this.#emit(nameBytes);
    await this.#emit(data);

    const crc = crc32(data);
    const descriptor = new DataView(new ArrayBuffer(16));
    descriptor.setUint32(0, 0x08074b50, true);
    descriptor.setUint32(4, crc, true);
    descriptor.setUint32(8, data.length, true);
    descriptor.setUint32(12, data.length, true);
    await this.#emit(new Uint8Array(descriptor.buffer));

    this.entries.push({ nameBytes, crc, size: data.length, offset, time, date });
  }

  /** Write the central directory. The writer is finished afterwards. */
  async close() {
    const start = this.offset;
    for (const e of this.entries) {
      const record = new DataView(new ArrayBuffer(46));
      record.setUint32(0, 0x02014b50, true);
      record.setUint16(4, 20, true); // version made by
      record.setUint16(6, 20, true); // version needed
      record.setUint16(8, 0x0808, true);
      record.setUint16(10, 0, true);
      record.setUint16(12, e.time, true);
      record.setUint16(14, e.date, true);
      record.setUint32(16, e.crc, true);
      record.setUint32(20, e.size, true);
      record.setUint32(24, e.size, true);
      record.setUint16(28, e.nameBytes.length, true);
      record.setUint32(42, e.offset, true);
      await this.#emit(new Uint8Array(record.buffer));
      await this.#emit(e.nameBytes);
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.entries.length, true);
    end.setUint16(10, this.entries.length, true);
    end.setUint32(12, this.offset - start, true);
    end.setUint32(16, start, true);
    await this.#emit(new Uint8Array(end.buffer));
  }
}
