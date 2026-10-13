// @ts-nocheck -- in-memory DynamoDB/S3 fakes are intentionally loose.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ---- in-memory AWS ----------------------------------------------------------
const aws = vi.hoisted(() => {
  const tables = {};
  const objects = new Map();
  const err = (name) => Object.assign(new Error(name), { name });
  const table = (name) => (tables[name] ||= new Map());
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  const resolve = (token, names) => (token.startsWith("#") ? names?.[token] : token);

  /** key condition + simple filter: "a = :x AND b > :y" */
  const matchesAll = (item, expr, names, values) =>
    expr.split(/\s+AND\s+/i).every((clause) => {
      const m = clause.trim().match(/^(\S+)\s*(=|>)\s*(:\w+)$/);
      if (!m) return true;
      const attr = resolve(m[1], names);
      const want = values[m[3]];
      return m[2] === "=" ? item[attr] === want : item[attr] > want;
    });

  const RANGE = { "galleryId-sortOrder-index": "sortOrder", "galleryId-createdAt-index": "createdAt" };

  function condition(item, expr, values) {
    if (!expr) return true;
    let m = expr.match(/^attribute_exists\((\w+)\)$/);
    if (m) return item !== undefined && item[m[1]] !== undefined;
    m = expr.match(/^attribute_not_exists\((\w+)\)$/);
    if (m) return item === undefined || item[m[1]] === undefined;
    m = expr.match(/^(\w+)\s*=\s*(:\w+)$/);
    if (m) return item !== undefined && item[m[1]] === values[m[2]];
    throw new Error(`fake: unsupported condition ${expr}`);
  }

  async function send(cmd) {
    const i = cmd.input;
    switch (cmd.constructor.name) {
      case "GetCommand": return { Item: clone(table(i.TableName).get(i.Key.id)) };
      case "PutCommand": {
        const t = table(i.TableName);
        if (!condition(t.get(i.Item.id), i.ConditionExpression, i.ExpressionAttributeValues)) throw err("ConditionalCheckFailedException");
        t.set(i.Item.id, clone(i.Item));
        return {};
      }
      case "DeleteCommand": table(i.TableName).delete(i.Key.id); return {};
      case "BatchWriteCommand": {
        for (const [name, reqs] of Object.entries(i.RequestItems)) for (const r of reqs) if (r.DeleteRequest) table(name).delete(r.DeleteRequest.Key.id);
        return { UnprocessedItems: {} };
      }
      case "BatchGetCommand": {
        const out = {};
        for (const [name, spec] of Object.entries(i.RequestItems)) out[name] = spec.Keys.map((k) => clone(table(name).get(k.id))).filter(Boolean);
        return { Responses: out };
      }
      case "UpdateCommand": {
        const t = table(i.TableName);
        const current = t.get(i.Key.id);
        if (!condition(current, i.ConditionExpression, i.ExpressionAttributeValues)) throw err("ConditionalCheckFailedException");
        const item = clone(current) || { id: i.Key.id };
        const [setPart, removePart] = i.UpdateExpression.replace(/^SET\s+/i, "SET ").split(/\s+REMOVE\s+/i);
        const names = i.ExpressionAttributeNames || {};
        const values = i.ExpressionAttributeValues || {};
        if (setPart.startsWith("SET ")) {
          for (const assignment of setPart.slice(4).split(",")) {
            const [lhs, rhs] = assignment.split("=").map((s) => s.trim());
            item[resolve(lhs, names)] = clone(values[rhs]);
          }
        } else if (setPart.startsWith("REMOVE ")) {
          for (const n of setPart.slice(7).split(",")) delete item[resolve(n.trim(), names)];
        }
        if (removePart) for (const n of removePart.split(",")) delete item[resolve(n.trim(), names)];
        t.set(i.Key.id, item);
        return i.ReturnValues === "ALL_NEW" ? { Attributes: clone(item) } : {};
      }
      case "ScanCommand": {
        const items = [...table(i.TableName).values()].filter((it) => !i.FilterExpression || matchesAll(it, i.FilterExpression, i.ExpressionAttributeNames, i.ExpressionAttributeValues));
        return { Items: clone(items) };
      }
      case "QueryCommand": {
        const range = RANGE[i.IndexName];
        let items = [...table(i.TableName).values()].filter((it) => matchesAll(it, i.KeyConditionExpression, i.ExpressionAttributeNames, i.ExpressionAttributeValues));
        if (range) items.sort((a, b) => (a[range] < b[range] ? -1 : a[range] > b[range] ? 1 : String(a.id).localeCompare(String(b.id))));
        if (i.ScanIndexForward === false) items.reverse();
        if (i.ExclusiveStartKey) {
          const at = items.findIndex((it) => it.id === i.ExclusiveStartKey.id);
          items = items.slice(at + 1);
        }
        let last;
        if (i.Limit && items.length > i.Limit) {
          items = items.slice(0, i.Limit);
          const l = items.at(-1);
          last = { id: l.id, galleryId: l.galleryId, sortOrder: l.sortOrder };
        }
        return { Items: clone(items), LastEvaluatedKey: last };
      }
      default: throw new Error(`fake: unsupported dynamo command ${cmd.constructor.name}`);
    }
  }

  async function s3send(cmd) {
    const i = cmd.input;
    switch (cmd.constructor.name) {
      case "HeadObjectCommand":
        if (!objects.has(i.Key)) throw err("NotFound");
        return { ContentLength: objects.get(i.Key) };
      case "DeleteObjectsCommand":
        for (const o of i.Delete.Objects) objects.delete(o.Key);
        return {};
      case "ListObjectsV2Command":
        return { Contents: [...objects.keys()].filter((k) => k.startsWith(i.Prefix)).map((Key) => ({ Key })), IsTruncated: false };
      default: throw new Error(`fake: unsupported s3 command ${cmd.constructor.name}`);
    }
  }

  return { tables, objects, send, s3send, reset() { for (const k of Object.keys(tables)) delete tables[k]; objects.clear(); } };
});


let handler, planReorder, hashPassword;
beforeAll(async () => {
  process.env.GALLERIES_TABLE = "galleries";
  process.env.PHOTOS_TABLE = "photos";
  process.env.AUDIT_TABLE = "audit";
  process.env.PHOTO_BUCKET = "bucket";
  const mod = await import("../lambda/handler.mjs");
  ({ handler, planReorder, hashPassword } = mod);
  // Swap in the in-memory fakes: these tests must never reach the network.
  mod.__useAws({
    db: { send: aws.send },
    s3: { send: aws.s3send },
    presign: async (_client, cmd, opts) => `https://signed.test/${cmd.input.Key}?ttl=${opts?.expiresIn}`,
  });
});
beforeEach(() => aws.reset());

// ---- helpers ----------------------------------------------------------------
const ev = (method, path, { body, headers = {}, query, team = false, ip = "198.51.100.7" } = {}) => ({
  rawPath: path,
  requestContext: { http: { method, path, sourceIp: ip }, authorizer: team ? { jwt: { claims: { sub: "team-1" } } } : undefined },
  headers: { "user-agent": "vitest", ...headers },
  queryStringParameters: query,
  body: body === undefined ? undefined : JSON.stringify(body),
});
const call = async (event) => {
  const res = await handler(event);
  return { status: res.statusCode, data: JSON.parse(res.body) };
};
const seedGallery = (over = {}) => {
  const g = { id: "g1", slug: "wedding", title: "Wedding", status: "PUBLISHED", sets: ["Highlights"], downloadEnabled: true, createdAt: "2026-01-01T00:00:00Z", createdById: "secret-user", ...over };
  aws.tables.galleries ||= new Map();
  aws.tables.galleries.set(g.id, g);
  return g;
};
const seedPhoto = (n, over = {}) => {
  const p = { id: `p${n}`, galleryId: "g1", filename: `IMG_${n}.jpg`, key: `originals/g1/p${n}/IMG_${n}.jpg`, thumbKey: `thumbs/g1/p${n}.jpg`, displayKey: `display/g1/p${n}.jpg`, setName: "Highlights", size: 1000 * n, width: 3000, height: 2000, sortOrder: n * 10, ...over };
  aws.tables.photos ||= new Map();
  aws.tables.photos.set(p.id, p);
  return p;
};
const auditActions = () => [...(aws.tables.audit?.values() ?? [])].map((e) => e.action);
const order = async () => (await call(ev("GET", "/galleries/g1"))).data.photos.map((p) => p.id);

// ---- tests ------------------------------------------------------------------
describe("public gallery", () => {
  it("hides drafts and never exposes internals or original keys", async () => {
    seedGallery({ status: "DRAFT" });
    expect((await call(ev("GET", "/galleries/g1"))).status).toBe(404);

    seedGallery();
    seedPhoto(1);
    const { status, data } = await call(ev("GET", "/galleries/slug/wedding"));
    expect(status).toBe(200);
    const text = JSON.stringify(data);
    expect(text).not.toContain("originals/");
    expect(text).not.toContain("secret-user");
    expect(data.photos[0].url).toContain("thumbs/g1/p1.jpg");
    expect(data.photos[0].displayUrl).toContain("display/g1/p1.jpg");
    expect(auditActions()).toEqual(["CLIENT_VISIT"]);
  });

  it("pages large galleries and validates cursors", async () => {
    seedGallery();
    for (let n = 1; n <= 850; n++) seedPhoto(n);
    const first = await call(ev("GET", "/galleries/g1"));
    expect(first.data.photos).toHaveLength(800);
    expect(first.data.nextCursor).toBeTruthy();
    const second = await call(ev("GET", "/galleries/g1", { query: { cursor: first.data.nextCursor } }));
    expect(second.data.photos).toHaveLength(50);
    expect(second.data.nextCursor).toBeNull();
    expect(new Set([...first.data.photos, ...second.data.photos].map((p) => p.id)).size).toBe(850);
    expect(auditActions().filter((a) => a === "CLIENT_VISIT")).toHaveLength(1); // only the first page counts as a visit
    expect((await call(ev("GET", "/galleries/g1", { query: { cursor: "garbage" } }))).status).toBe(400);
  });

  it("enforces expiry", async () => {
    seedGallery({ expiresAt: "2000-01-01" });
    expect((await call(ev("GET", "/galleries/g1"))).status).toBe(410);
  });
});

describe("password protection", () => {
  it("requires the password and throttles guessing per IP", async () => {
    seedGallery({ passwordHash: hashPassword("open-sesame") });
    seedPhoto(1);
    expect((await call(ev("GET", "/galleries/g1"))).status).toBe(401);
    const guess = (pw, ip) => call(ev("GET", "/galleries/g1", { headers: { "x-gallery-password": pw }, ip }));
    for (let i = 0; i < 8; i++) expect((await guess(`nope-${i}`, "203.0.113.50")).status).toBe(401);
    expect((await guess("open-sesame", "203.0.113.50")).status).toBe(429); // even the right one: this IP is locked out
    expect((await guess("open-sesame", "203.0.113.51")).status).toBe(200); // other visitors are unaffected
    expect(auditActions().filter((a) => a === "PASSWORD_FAIL")).toHaveLength(8);
  });
});

describe("downloads", () => {
  it("signs a single original and records it", async () => {
    seedGallery();
    seedPhoto(1);
    const { status, data } = await call(ev("GET", "/download", { query: { id: "p1" } }));
    expect(status).toBe(200);
    expect(data.url).toContain("originals/g1/p1/IMG_1.jpg");
    expect(auditActions()).toEqual(["DOWNLOAD"]);
  });

  it("respects downloadEnabled and gallery state", async () => {
    seedGallery({ downloadEnabled: false });
    seedPhoto(1);
    expect((await call(ev("GET", "/download", { query: { id: "p1" } }))).status).toBe(403);
    expect((await call(ev("POST", "/galleries/g1/downloads", { body: {} }))).status).toBe(403);
    seedGallery({ status: "DRAFT" });
    expect((await call(ev("GET", "/download", { query: { id: "p1" } }))).status).toBe(404);
    expect((await call(ev("GET", "/download", { query: { id: "missing" } }))).status).toBe(404);
  });

  it("returns archive URLs in gallery order, for all or a selection", async () => {
    seedGallery();
    seedPhoto(3); seedPhoto(1); seedPhoto(2);
    const all = await call(ev("POST", "/galleries/g1/downloads", { body: {} }));
    expect(all.data.files.map((f) => f.id)).toEqual(["p1", "p2", "p3"]);
    expect(all.data.files[0].url).toContain("originals/");
    const some = await call(ev("POST", "/galleries/g1/downloads", { body: { photoIds: ["p3", "p1", "nope"] } }));
    expect(some.data.files.map((f) => f.id)).toEqual(["p1", "p3"]);
    expect((await call(ev("POST", "/galleries/g1/downloads", { body: { photoIds: ["nope"] } }))).status).toBe(400);
    const archive = [...aws.tables.audit.values()].filter((e) => e.action === "DOWNLOAD_ARCHIVE");
    expect(archive.map((e) => [e.scope, e.count])).toEqual(expect.arrayContaining([["all", 3], ["selection", 2]]));
  });

  it("rate limits archive requests", async () => {
    seedGallery();
    seedPhoto(1);
    for (let i = 0; i < 20; i++) expect((await call(ev("POST", "/galleries/g1/downloads", { body: {} }))).status).toBe(200);
    expect((await call(ev("POST", "/galleries/g1/downloads", { body: {} }))).status).toBe(429);
  });
});

describe("client selection", () => {
  it("stores only photos that exist and validates the contact", async () => {
    seedGallery();
    seedPhoto(1); seedPhoto(2);
    const ok = await call(ev("POST", "/galleries/g1/selection", { body: { name: "Мария", email: "Maria@Example.com", photoIds: ["p2", "ghost", "p2"] } }));
    expect(ok.data).toMatchObject({ ok: true, count: 1 });
    const saved = [...aws.tables.audit.values()].find((e) => e.action === "SELECTION");
    expect(saved).toMatchObject({ email: "maria@example.com", photoIds: ["p2"] });
    expect((await call(ev("POST", "/galleries/g1/selection", { body: { name: "X", email: "not-an-email", photoIds: ["p1"] } }))).status).toBe(400);
    expect((await call(ev("POST", "/galleries/g1/selection", { body: { name: "X", email: "a@b.co", photoIds: ["ghost"] } }))).status).toBe(400);
  });
});

describe("manual ordering", () => {
  it("planReorder lets the given photos keep their slots", () => {
    const photos = [10, 20, 30, 40, 50].map((n, i) => ({ id: `p${i + 1}`, sortOrder: n }));
    expect(planReorder(photos, ["p4", "p2"])).toEqual(expect.arrayContaining([{ id: "p4", sortOrder: 20 }, { id: "p2", sortOrder: 40 }]));
    expect(planReorder(photos, ["p4", "p2"])).toHaveLength(2);
    expect(planReorder(photos, ["p1", "p2", "p3", "p4", "p5"])).toEqual([]); // already in order
    expect(planReorder(photos, ["p1"])).toBeNull();
    expect(planReorder(photos, ["p1", "ghost"])).toBeNull();
    expect(planReorder(photos, "p1")).toBeNull();
  });

  it("renumbers legacy rows that share a sortOrder", () => {
    const photos = [{ id: "a", sortOrder: 5 }, { id: "b", sortOrder: 5 }, { id: "c", sortOrder: 5 }];
    const updates = planReorder(photos, ["c", "a"]);
    const final = new Map(photos.map((p) => [p.id, p.sortOrder]));
    updates.forEach((u) => final.set(u.id, u.sortOrder));
    expect(new Set(final.values()).size).toBe(3); // all distinct now
    expect(final.get("c")).toBeLessThan(final.get("a"));
  });

  it("persists a new order that clients then see", async () => {
    seedGallery();
    for (let n = 1; n <= 5; n++) seedPhoto(n);
    expect(await order()).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    const res = await call(ev("POST", "/admin/galleries/g1/order", { team: true, body: { order: ["p5", "p1", "p2", "p3", "p4"] } }));
    expect(res.data).toMatchObject({ ok: true });
    expect(await order()).toEqual(["p5", "p1", "p2", "p3", "p4"]);
    expect(auditActions()).toContain("PHOTOS_REORDERED");
  });

  it("moves a subset without disturbing other photos", async () => {
    seedGallery({ sets: ["A", "B"] });
    [["p1", "A"], ["p2", "B"], ["p3", "A"], ["p4", "B"], ["p5", "A"]].forEach(([id, set], i) => seedPhoto(i + 1, { setName: set }));
    await call(ev("POST", "/admin/galleries/g1/order", { team: true, body: { order: ["p5", "p3", "p1"] } })); // only set A
    expect(await order()).toEqual(["p5", "p2", "p3", "p4", "p1"]); // B photos stay at slots 2 and 4
  });

  it("rejects bad input and unauthenticated callers", async () => {
    seedGallery();
    seedPhoto(1); seedPhoto(2);
    const post = (body, team = true) => call(ev("POST", "/admin/galleries/g1/order", { team, body }));
    expect((await post({ order: ["p1"] })).status).toBe(400);
    expect((await post({ order: ["p1", "ghost"] })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ order: ["p2", "p1"] }, false)).status).toBe(401);
    expect((await call(ev("POST", "/admin/galleries/nope/order", { team: true, body: { order: ["p1", "p2"] } }))).status).toBe(404);
  });
});

describe("team gallery management", () => {
  it("moves photos out of a removed set", async () => {
    seedGallery({ sets: ["A", "B"] });
    seedPhoto(1, { setName: "A" }); seedPhoto(2, { setName: "B" });
    const res = await call(ev("PATCH", "/admin/galleries/g1", { team: true, body: { sets: ["A"] } }));
    expect(res.status).toBe(200);
    expect(aws.tables.photos.get("p2").setName).toBe("A");
  });

  it("deletes everything under the gallery prefixes, including orphans", async () => {
    seedGallery();
    seedPhoto(1);
    aws.objects.set("originals/g1/p1/IMG_1.jpg", 10);
    aws.objects.set("thumbs/g1/p1.jpg", 1);
    aws.objects.set("originals/g1/orphan/never-confirmed.jpg", 10); // uploaded, row never created
    aws.objects.set("originals/g2/other/keep.jpg", 10);
    const res = await call(ev("DELETE", "/admin/galleries/g1", { team: true }));
    expect(res.data).toMatchObject({ ok: true, photos: 1 });
    expect([...aws.objects.keys()]).toEqual(["originals/g2/other/keep.jpg"]);
    expect(aws.tables.galleries.has("g1")).toBe(false);
    expect(aws.tables.photos.size).toBe(0);
  });

  it("confirms an upload only when the file exists and sets the first cover", async () => {
    seedGallery();
    const photoId = "11111111-2222-3333-4444-555555555555";
    const body = { photoId, filename: "A.jpg", contentType: "image/jpeg", size: 123, width: 3000, height: 2000, sortOrder: 1 };
    expect((await call(ev("POST", "/admin/galleries/g1/photos", { team: true, body }))).data.error).toBe("upload-missing");

    aws.objects.set(`originals/g1/${photoId}/A.jpg`, 5000);
    aws.objects.set(`thumbs/g1/${photoId}.jpg`, 100);
    const ok = await call(ev("POST", "/admin/galleries/g1/photos", { team: true, body }));
    expect(ok.status).toBe(201);
    const photo = aws.tables.photos.get(photoId);
    expect(photo).toMatchObject({ size: 5000, thumbKey: `thumbs/g1/${photoId}.jpg`, width: 3000 });
    expect(photo.displayKey).toBeUndefined(); // not uploaded -> not recorded
    expect(aws.tables.galleries.get("g1").coverPhotoId).toBe(photoId);
  });

  it("returns activity newest first without internal fields", async () => {
    seedGallery();
    await call(ev("GET", "/galleries/g1"));
    await call(ev("GET", "/galleries/g1"));
    const res = await call(ev("GET", "/admin/galleries/g1/activity", { team: true }));
    expect(res.data.events).toHaveLength(2);
    expect(res.data.events[0].createdAt >= res.data.events[1].createdAt).toBe(true);
    expect(res.data.events[0]).not.toHaveProperty("ttl");
  });
});
