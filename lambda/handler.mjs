import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchGetCommand, BatchWriteCommand, DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

let db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
let s3 = new S3Client({});
let presign = getSignedUrl;

/** Test seam: swap the AWS clients so tests can run against in-memory fakes and never touch the network. */
export function __useAws(clients) {
  ({ db = db, s3 = s3, presign = presign } = clients);
}

const MAX_UPLOAD = 50 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const STATUSES = new Set(["DRAFT", "PUBLISHED"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const AUDIT_TTL_SECONDS = 2 * 365 * 24 * 3600;
const PAGE_SIZE = 800; // keeps one response far below the 6 MB Lambda payload limit
const ARCHIVE_MAX = 2000;
const VIEW_URL_TTL = 3600;
const ARCHIVE_URL_TTL = 6 * 3600;

class HttpError extends Error {
  constructor(statusCode, code) {
    super(code);
    this.statusCode = statusCode;
  }
}

const json = (data, statusCode = 200) => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "access-control-allow-origin": process.env.ALLOWED_ORIGIN || "*",
    "access-control-allow-headers": "content-type,authorization,x-gallery-password",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "cache-control": "no-store",
  },
  body: JSON.stringify(data),
});

const trim = (value, max) => String(value ?? "").trim().slice(0, max);

// ---------- pure helpers (exported for tests) ----------

export const validateUpload = (input = {}) => {
  const size = Number(input.size);
  const filename = String(input.filename || "photo.jpg").split(/[\\/]/).pop().replace(/[^a-zA-Z0-9._() -]/g, "_").slice(0, 120) || "photo.jpg";
  if (!IMAGE_TYPES.has(input.contentType) || !Number.isSafeInteger(size) || size < 1 || size > MAX_UPLOAD) return null;
  return { filename, size, contentType: input.contentType };
};

const CYRILLIC = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht", ъ: "a", ь: "", ю: "yu", я: "ya" };

export const slugify = (text) =>
  String(text ?? "")
    .toLowerCase()
    .replace(/[а-я]/g, (c) => CYRILLIC[c] ?? "")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");

export const validSlug = (slug) => typeof slug === "string" && slug.length >= 2 && slug.length <= 60 && SLUG_RE.test(slug);

export const hashPassword = (plain) => {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(plain, salt, 32).toString("hex")}`;
};

export const verifyPassword = (plain, stored) => {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(String(plain), Buffer.from(salt, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

/** Throws HttpError unless a visitor may see this gallery. Pure: no I/O. */
export const assertVisible = (gallery, password, today = new Date().toISOString().slice(0, 10)) => {
  if (!gallery || gallery.status !== "PUBLISHED") throw new HttpError(404, "not-found");
  if (gallery.expiresAt && gallery.expiresAt < today) throw new HttpError(410, "expired");
  if (gallery.passwordHash && !(password && verifyPassword(password, gallery.passwordHash))) throw new HttpError(401, "password-required");
  return gallery;
};

/** The only gallery fields a client ever sees. */
export const publicGallery = (g) => ({
  id: g.id,
  slug: g.slug,
  title: g.title,
  description: g.description ?? null,
  displayDate: g.displayDate ?? null,
  coverPhotoId: g.coverPhotoId ?? null,
  sets: g.sets?.length ? g.sets : ["Highlights"],
  downloadEnabled: g.downloadEnabled !== false,
  createdAt: g.createdAt,
});

const adminGallery = (g, counts = {}, coverUrl = null) => {
  const { passwordHash, ...rest } = g;
  return { ...rest, hasPassword: Boolean(passwordHash), photoCount: counts.count || 0, photoBytes: counts.bytes || 0, coverUrl };
};

export const encodeCursor = (key) => Buffer.from(JSON.stringify(key)).toString("base64url");

export function decodeCursor(cursor, galleryId) {
  try {
    const key = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    if (typeof key?.id === "string" && key.galleryId === galleryId && typeof key.sortOrder === "number") return { id: key.id, galleryId, sortOrder: key.sortOrder };
  } catch { /* fall through */ }
  throw new HttpError(400, "invalid-cursor");
}

/**
 * Manual ordering. `order` is the desired order of some photos of a gallery.
 * Those photos keep the *slots* they already occupy in the global order and are
 * refilled in the requested order, so photos not mentioned never move.
 * Returns the minimal list of {id, sortOrder} updates, or null for invalid input.
 */
export function planReorder(photos, order) {
  const ids = [...new Set(Array.isArray(order) ? order.map(String) : [])];
  const byId = new Map(photos.map((p) => [p.id, p]));
  if (ids.length < 2 || ids.some((id) => !byId.has(id))) return null;

  const list = [...photos].sort((a, b) => (Number(a.sortOrder) - Number(b.sortOrder)) || String(a.id).localeCompare(String(b.id)));
  let values = list.map((p) => Number(p.sortOrder) || 0);
  // Legacy rows can share a sortOrder. Renumber everything once so slots are unambiguous.
  if (values.some((v, i) => i > 0 && v <= values[i - 1])) values = list.map((_, i) => (i + 1) * 1000);

  const position = new Map(list.map((p, i) => [p.id, i]));
  const slots = ids.map((id) => position.get(id)).sort((a, b) => a - b);
  const next = new Map(list.map((p, i) => [p.id, values[i]]));
  ids.forEach((id, k) => next.set(id, values[slots[k]]));

  return list.filter((p) => next.get(p.id) !== Number(p.sortOrder)).map((p) => ({ id: p.id, sortOrder: next.get(p.id) }));
}

// ---------- DynamoDB / S3 helpers ----------

const T = {
  galleries: () => process.env.GALLERIES_TABLE,
  photos: () => process.env.PHOTOS_TABLE,
  audit: () => process.env.AUDIT_TABLE,
};

async function queryAll(params) {
  const items = [];
  let key;
  do {
    const r = await db.send(new QueryCommand({ ...params, ExclusiveStartKey: key }));
    items.push(...(r.Items || []));
    key = r.LastEvaluatedKey;
  } while (key);
  return items;
}

async function scanAll(params) {
  const items = [];
  let key;
  do {
    const r = await db.send(new ScanCommand({ ...params, ExclusiveStartKey: key }));
    items.push(...(r.Items || []));
    key = r.LastEvaluatedKey;
  } while (key);
  return items;
}

/** First item where attr === value. Uses the index; falls back to a full scan until the index is deployed. */
async function lookup(table, index, attr, value) {
  try {
    const r = await db.send(new QueryCommand({ TableName: table, IndexName: index, KeyConditionExpression: "#a = :v", ExpressionAttributeNames: { "#a": attr }, ExpressionAttributeValues: { ":v": value }, Limit: 1 }));
    return r.Items?.[0];
  } catch (error) {
    if (error.name !== "ValidationException") throw error; // ponytail: remove fallback once indexes are live everywhere
    return (await scanAll({ TableName: table, FilterExpression: "#a = :v", ExpressionAttributeNames: { "#a": attr }, ExpressionAttributeValues: { ":v": value } }))[0];
  }
}

const getItem = async (table, id) => (await db.send(new GetCommand({ TableName: table, Key: { id } }))).Item;
const photosOf = (galleryId) => queryAll({ TableName: T.photos(), IndexName: "galleryId-sortOrder-index", KeyConditionExpression: "galleryId = :g", ExpressionAttributeValues: { ":g": galleryId } });

async function photosPage(galleryId, cursor) {
  const r = await db.send(new QueryCommand({
    TableName: T.photos(), IndexName: "galleryId-sortOrder-index", KeyConditionExpression: "galleryId = :g", ExpressionAttributeValues: { ":g": galleryId },
    Limit: PAGE_SIZE, ExclusiveStartKey: cursor ? decodeCursor(cursor, galleryId) : undefined,
  }));
  return { items: r.Items || [], next: r.LastEvaluatedKey ? encodeCursor(r.LastEvaluatedKey) : null };
}

const sign = (key, extra = {}, expiresIn = VIEW_URL_TTL) => presign(s3, new GetObjectCommand({ Bucket: process.env.PHOTO_BUCKET, Key: key, ...extra }), { expiresIn });
const signPut = (key, contentType) => presign(s3, new PutObjectCommand({ Bucket: process.env.PHOTO_BUCKET, Key: key, ContentType: contentType }), { expiresIn: 900 });

const ipOf = (event) => event.requestContext?.http?.sourceIp || null;

async function audit(event, action, data = {}) {
  try {
    await db.send(new PutCommand({
      TableName: T.audit(),
      Item: {
        id: `${Date.now()}-${randomUUID()}`,
        action,
        actorId: event.requestContext?.authorizer?.jwt?.claims?.sub || null,
        ip: ipOf(event),
        userAgent: trim(event.headers?.["user-agent"], 200) || null,
        createdAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + AUDIT_TTL_SECONDS,
        ...data,
      },
    }));
  } catch (error) {
    console.error("audit failed", action, error); // never fail a request because logging failed
  }
}

/** Audit events of one gallery, newest first. Index first, scan until the index exists. */
async function auditOf(galleryId, { since, limit = 1000 } = {}) {
  try {
    const r = await db.send(new QueryCommand({
      TableName: T.audit(), IndexName: "galleryId-createdAt-index",
      KeyConditionExpression: since ? "galleryId = :g AND createdAt > :t" : "galleryId = :g",
      ExpressionAttributeValues: since ? { ":g": galleryId, ":t": since } : { ":g": galleryId },
      ScanIndexForward: false, Limit: limit,
    }));
    return r.Items || [];
  } catch (error) {
    if (error.name !== "ValidationException") throw error; // ponytail: remove fallback once index is live
    return (await scanAll({ TableName: T.audit(), FilterExpression: "galleryId = :g", ExpressionAttributeValues: { ":g": galleryId } }))
      .filter((e) => !since || e.createdAt > since)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit);
  }
}

/** True when this IP already did `action` on this gallery `max` times within the window. */
async function rateLimited(event, galleryId, action, max, windowSeconds) {
  const ip = ipOf(event);
  if (!ip) return false;
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const events = await auditOf(galleryId, { since });
  return events.filter((e) => e.action === action && e.ip === ip).length >= max;
}

async function deleteObjects(keys) {
  for (let i = 0; i < keys.length; i += 1000) {
    const res = await s3.send(new DeleteObjectsCommand({ Bucket: process.env.PHOTO_BUCKET, Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true } }));
    if (res.Errors?.length) throw new Error(`S3 delete failed: ${res.Errors[0].Code}`);
  }
}

/** Delete everything under a prefix, including objects with no database row (failed uploads). */
async function deletePrefix(prefix) {
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: process.env.PHOTO_BUCKET, Prefix: prefix, ContinuationToken: token }));
    await deleteObjects((r.Contents || []).map((o) => o.Key));
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
}

async function deletePhotoItems(ids) {
  for (let i = 0; i < ids.length; i += 25) {
    let requests = ids.slice(i, i + 25).map((id) => ({ DeleteRequest: { Key: { id } } }));
    for (let attempt = 0; requests.length && attempt < 5; attempt++) {
      const r = await db.send(new BatchWriteCommand({ RequestItems: { [T.photos()]: requests } }));
      requests = r.UnprocessedItems?.[T.photos()] || [];
    }
    if (requests.length) throw new Error("photo delete incomplete");
  }
}

/** Run async work over items with a small concurrency cap. */
async function mapLimit(items, limit, fn) {
  for (let i = 0; i < items.length; i += limit) await Promise.all(items.slice(i, i + limit).map(fn));
}

const photoKeys = (p) => [p.key, p.thumbKey, p.displayKey].filter(Boolean);

function body(event) {
  if (!event.body) return {};
  try {
    const text = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
    const value = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch {
    throw new HttpError(400, "invalid-json");
  }
}

// ---------- public routes ----------

async function findGallery(ref) {
  return ref.slug !== undefined ? lookup(T.galleries(), "slug-index", "slug", ref.slug) : getItem(T.galleries(), ref.id);
}

async function openGallery(event, ref) {
  const gallery = await findGallery(ref);
  const given = event.headers?.["x-gallery-password"];
  const guessing = Boolean(given && gallery?.status === "PUBLISHED" && gallery.passwordHash);
  if (guessing && (await rateLimited(event, gallery.id, "PASSWORD_FAIL", 8, 600))) throw new HttpError(429, "too-many-attempts");
  try {
    return assertVisible(gallery, given);
  } catch (error) {
    if (guessing && error.message === "password-required") await audit(event, "PASSWORD_FAIL", { galleryId: gallery.id });
    throw error;
  }
}

const galleryRef = (parts) => (parts[1] === "slug" ? { slug: decodeURIComponent(parts[2] || "") } : { id: parts[1] });

async function viewGallery(event, parts) {
  const gallery = await openGallery(event, galleryRef(parts));
  const cursor = event.queryStringParameters?.cursor;
  const page = await photosPage(gallery.id, cursor);
  if (!cursor) await audit(event, "CLIENT_VISIT", { galleryId: gallery.id });
  return json({
    gallery: publicGallery(gallery),
    photos: await Promise.all(page.items.map(async (p) => ({
      id: p.id,
      filename: p.filename,
      setName: p.setName || "Highlights",
      width: p.width || null,
      height: p.height || null,
      size: p.size || 0,
      url: await sign(p.thumbKey || p.displayKey || p.key),
      displayUrl: await sign(p.displayKey || p.key),
    }))),
    nextCursor: page.next,
  });
}

async function download(event) {
  const id = event.queryStringParameters?.id;
  if (!id) throw new HttpError(400, "missing-id");
  const photo = await getItem(T.photos(), id);
  if (!photo) throw new HttpError(404, "not-found");
  const gallery = await openGallery(event, { id: photo.galleryId });
  if (gallery.downloadEnabled === false) throw new HttpError(403, "downloads-disabled");
  const safeName = String(photo.filename || "photo.jpg").replace(/[^a-zA-Z0-9._() -]/g, "_");
  const url = await sign(photo.key, { ResponseContentDisposition: `attachment; filename="${safeName}"` }, 300);
  await audit(event, "DOWNLOAD", { galleryId: gallery.id, photoId: photo.id, filename: photo.filename });
  return json({ url, filename: photo.filename });
}

/** One call returns presigned originals for the whole gallery (or a selection); the browser zips them. */
async function archiveUrls(event, parts) {
  const gallery = await openGallery(event, galleryRef(parts));
  if (gallery.downloadEnabled === false) throw new HttpError(403, "downloads-disabled");
  if (await rateLimited(event, gallery.id, "DOWNLOAD_ARCHIVE", 20, 3600)) throw new HttpError(429, "too-many-requests");
  const input = body(event);
  const scope = Array.isArray(input.photoIds) ? "selection" : "all";
  let photos = await photosOf(gallery.id);
  if (scope === "selection") {
    const wanted = new Set(input.photoIds.map(String));
    photos = photos.filter((p) => wanted.has(p.id));
  }
  if (!photos.length) throw new HttpError(400, "empty-selection");
  if (photos.length > ARCHIVE_MAX) throw new HttpError(413, "too-many-photos");
  const files = await Promise.all(photos.map(async (p) => ({
    id: p.id,
    filename: p.filename,
    setName: p.setName || "Highlights",
    size: Number(p.size) || 0,
    url: await sign(p.key, {}, ARCHIVE_URL_TTL),
  })));
  await audit(event, "DOWNLOAD_ARCHIVE", { galleryId: gallery.id, scope, count: files.length, bytes: files.reduce((n, f) => n + f.size, 0) });
  return json({ title: gallery.title, files });
}

async function submitSelection(event, parts) {
  const gallery = await openGallery(event, galleryRef(parts));
  if (await rateLimited(event, gallery.id, "SELECTION", 10, 3600)) throw new HttpError(429, "too-many-requests");
  const input = body(event);
  const name = trim(input.name, 120);
  const email = trim(input.email, 200).toLowerCase();
  const note = trim(input.note, 1000);
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "invalid-contact");
  if (!Array.isArray(input.photoIds)) throw new HttpError(400, "invalid-selection");
  const known = new Set((await photosOf(gallery.id)).map((p) => p.id));
  const photoIds = [...new Set(input.photoIds.map(String))].filter((id) => known.has(id)).slice(0, 500);
  if (!photoIds.length) throw new HttpError(400, "empty-selection");
  await audit(event, "SELECTION", { galleryId: gallery.id, name, email, note, photoIds });
  return json({ ok: true, count: photoIds.length });
}

// ---------- team routes ----------

const requireTeam = (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims || {};
  if (!claims.sub) throw new HttpError(401, "unauthorized");
  return claims;
};

/** Builds a DynamoDB update expression. Shape validation happens here. */
function patchGallery(input) {
  const names = {};
  const values = { ":updatedAt": new Date().toISOString() };
  const sets = ["#updatedAt = :updatedAt"];
  const removes = [];
  names["#updatedAt"] = "updatedAt";
  const set = (field, value) => { names[`#${field}`] = field; values[`:${field}`] = value; sets.push(`#${field} = :${field}`); };
  const remove = (field) => { names[`#${field}`] = field; removes.push(`#${field}`); };
  const changed = [];

  if (input.title !== undefined) {
    const title = trim(input.title, 160);
    if (!title) throw new HttpError(400, "invalid-title");
    set("title", title); changed.push("title");
  }
  if (input.description !== undefined) {
    const description = trim(input.description, 2000);
    description ? set("description", description) : remove("description"); changed.push("description");
  }
  if (input.displayDate !== undefined) {
    if (!DATE_RE.test(String(input.displayDate))) throw new HttpError(400, "invalid-date");
    set("displayDate", String(input.displayDate)); changed.push("displayDate");
  }
  if (input.status !== undefined) {
    if (!STATUSES.has(input.status)) throw new HttpError(400, "invalid-status");
    set("status", input.status); changed.push("status");
  }
  if (input.downloadEnabled !== undefined) {
    if (typeof input.downloadEnabled !== "boolean") throw new HttpError(400, "invalid-downloads");
    set("downloadEnabled", input.downloadEnabled); changed.push("downloadEnabled");
  }
  if (input.expiresAt !== undefined) {
    if (input.expiresAt === null || input.expiresAt === "") remove("expiresAt");
    else if (DATE_RE.test(String(input.expiresAt))) set("expiresAt", String(input.expiresAt));
    else throw new HttpError(400, "invalid-expiry");
    changed.push("expiresAt");
  }
  if (input.password !== undefined) {
    if (input.password === null || input.password === "") remove("passwordHash");
    else if (typeof input.password === "string" && input.password.length >= 4 && input.password.length <= 120) set("passwordHash", hashPassword(input.password));
    else throw new HttpError(400, "invalid-password");
    changed.push("password");
  }
  if (input.sets !== undefined) {
    const list = Array.isArray(input.sets) ? [...new Set(input.sets.map((s) => trim(s, 60)).filter(Boolean))].slice(0, 20) : [];
    if (!list.length) throw new HttpError(400, "invalid-sets");
    set("sets", list); changed.push("sets");
  }
  if (input.slug !== undefined) { set("slug", input.slug); changed.push("slug"); }
  if (input.coverPhotoId !== undefined) { set("coverPhotoId", input.coverPhotoId); changed.push("coverPhotoId"); }
  if (!changed.length) throw new HttpError(400, "nothing-to-update");
  return { names, values, changed, expression: `SET ${sets.join(", ")}${removes.length ? ` REMOVE ${removes.join(", ")}` : ""}` };
}

async function admin(event, method, path) {
  const actor = requireTeam(event);
  const [, area, id, sub] = path.split("/").filter(Boolean);
  const route = `${method} ${area}${id ? "/:id" : ""}${sub ? `/${sub}` : ""}`;
  const input = method === "GET" || method === "DELETE" ? {} : body(event);

  switch (route) {
    case "GET galleries": {
      const [galleries, photos] = await Promise.all([
        scanAll({ TableName: T.galleries() }),
        scanAll({ TableName: T.photos(), ProjectionExpression: "galleryId, #s", ExpressionAttributeNames: { "#s": "size" } }),
      ]);
      const counts = {};
      for (const p of photos) {
        const c = (counts[p.galleryId] ||= { count: 0, bytes: 0 });
        c.count += 1;
        c.bytes += Number(p.size) || 0;
      }
      galleries.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      const coverIds = galleries.map((g) => g.coverPhotoId).filter(Boolean);
      const covers = {};
      for (let i = 0; i < coverIds.length; i += 100) {
        const r = await db.send(new BatchGetCommand({ RequestItems: { [T.photos()]: { Keys: coverIds.slice(i, i + 100).map((cid) => ({ id: cid })) } } }));
        for (const p of r.Responses?.[T.photos()] || []) covers[p.id] = p;
      }
      return json({
        galleries: await Promise.all(galleries.map(async (g) => {
          const c = covers[g.coverPhotoId];
          return adminGallery(g, counts[g.id], c ? await sign(c.thumbKey || c.displayKey || c.key, {}, 900) : null);
        })),
      });
    }

    case "POST galleries": {
      const title = trim(input.title, 160);
      if (!title) throw new HttpError(400, "invalid-title");
      const displayDate = input.displayDate === undefined ? new Date().toISOString().slice(0, 10) : String(input.displayDate);
      if (!DATE_RE.test(displayDate)) throw new HttpError(400, "invalid-date");
      const now = new Date().toISOString();
      const item = {
        id: randomUUID(),
        slug: `${slugify(title) || "gallery"}-${randomBytes(3).toString("hex")}`,
        title,
        displayDate,
        sets: ["Highlights"],
        status: "DRAFT",
        downloadEnabled: true,
        createdById: actor.sub,
        createdAt: now,
        updatedAt: now,
      };
      const description = trim(input.description, 2000);
      if (description) item.description = description;
      await db.send(new PutCommand({ TableName: T.galleries(), Item: item, ConditionExpression: "attribute_not_exists(id)" }));
      await audit(event, "GALLERY_CREATED", { galleryId: item.id });
      return json({ gallery: adminGallery(item) }, 201);
    }

    case "PATCH galleries/:id": {
      if (input.slug !== undefined) {
        if (!validSlug(input.slug)) throw new HttpError(400, "invalid-slug");
        const other = await lookup(T.galleries(), "slug-index", "slug", input.slug);
        if (other && other.id !== id) throw new HttpError(409, "slug-taken");
      }
      if (input.coverPhotoId !== undefined) {
        const photo = typeof input.coverPhotoId === "string" ? await getItem(T.photos(), input.coverPhotoId) : null;
        if (!photo || photo.galleryId !== id) throw new HttpError(400, "invalid-cover");
      }
      const plan = patchGallery(input);
      const r = await db.send(new UpdateCommand({ TableName: T.galleries(), Key: { id }, UpdateExpression: plan.expression, ConditionExpression: "attribute_exists(id)", ExpressionAttributeNames: plan.names, ExpressionAttributeValues: plan.values, ReturnValues: "ALL_NEW" }));
      if (plan.changed.includes("sets")) {
        // Photos of a removed set move to the first remaining set instead of disappearing from the admin filter.
        const current = r.Attributes.sets;
        const orphans = (await photosOf(id)).filter((p) => !current.includes(p.setName || "Highlights"));
        await mapLimit(orphans, 20, (p) => db.send(new UpdateCommand({ TableName: T.photos(), Key: { id: p.id }, UpdateExpression: "SET setName = :s", ExpressionAttributeValues: { ":s": current[0] } })));
      }
      await audit(event, "GALLERY_UPDATED", { galleryId: id, fields: plan.changed });
      return json({ gallery: adminGallery(r.Attributes) });
    }

    case "DELETE galleries/:id": {
      if (!(await getItem(T.galleries(), id))) throw new HttpError(404, "not-found");
      const photos = await photosOf(id);
      await Promise.all([`originals/${id}/`, `thumbs/${id}/`, `display/${id}/`].map(deletePrefix));
      await deletePhotoItems(photos.map((p) => p.id));
      await db.send(new DeleteCommand({ TableName: T.galleries(), Key: { id } }));
      await audit(event, "GALLERY_DELETED", { galleryId: id, photos: photos.length });
      return json({ ok: true, photos: photos.length });
    }

    case "GET galleries/:id/photos": {
      const photos = await photosOf(id);
      return json({
        photos: await Promise.all(photos.map(async (p) => ({
          id: p.id, filename: p.filename, setName: p.setName || "Highlights", size: p.size || 0, width: p.width || null, height: p.height || null,
          url: await sign(p.thumbKey || p.displayKey || p.key, {}, 900),
        }))),
      });
    }

    case "POST galleries/:id/order": {
      if (!(await getItem(T.galleries(), id))) throw new HttpError(404, "not-found");
      const updates = planReorder(await photosOf(id), input.order);
      if (!updates) throw new HttpError(400, "invalid-order");
      await mapLimit(updates, 20, (u) => db.send(new UpdateCommand({ TableName: T.photos(), Key: { id: u.id }, UpdateExpression: "SET sortOrder = :s", ConditionExpression: "attribute_exists(id)", ExpressionAttributeValues: { ":s": u.sortOrder } })));
      await audit(event, "PHOTOS_REORDERED", { galleryId: id, moved: updates.length });
      return json({ ok: true, moved: updates.length });
    }

    case "POST galleries/:id/upload": {
      const gallery = await getItem(T.galleries(), id);
      if (!gallery) throw new HttpError(404, "not-found");
      const upload = validateUpload(input);
      if (!upload) throw new HttpError(400, "invalid-image");
      const photoId = randomUUID();
      const keys = {
        original: `originals/${id}/${photoId}/${upload.filename}`,
        display: `display/${id}/${photoId}.jpg`,
        thumb: `thumbs/${id}/${photoId}.jpg`,
      };
      const [original, display, thumb] = await Promise.all([signPut(keys.original, upload.contentType), signPut(keys.display, "image/jpeg"), signPut(keys.thumb, "image/jpeg")]);
      return json({ photoId, filename: upload.filename, keys, urls: { original, display, thumb } });
    }

    case "POST galleries/:id/photos": {
      const gallery = await getItem(T.galleries(), id);
      if (!gallery) throw new HttpError(404, "not-found");
      const upload = validateUpload(input);
      const photoId = String(input.photoId || "");
      if (!upload || !/^[0-9a-f-]{36}$/i.test(photoId)) throw new HttpError(400, "invalid-image");
      const keys = {
        key: `originals/${id}/${photoId}/${upload.filename}`,
        displayKey: `display/${id}/${photoId}.jpg`,
        thumbKey: `thumbs/${id}/${photoId}.jpg`,
      };
      const head = async (Key) => s3.send(new HeadObjectCommand({ Bucket: process.env.PHOTO_BUCKET, Key })).catch(() => null);
      const [original, display, thumb] = await Promise.all([head(keys.key), head(keys.displayKey), head(keys.thumbKey)]);
      if (!original) throw new HttpError(400, "upload-missing");
      const size = Number(original.ContentLength) || upload.size;
      if (size > MAX_UPLOAD) throw new HttpError(400, "invalid-image");
      const dim = (v) => (Number.isSafeInteger(Number(v)) && Number(v) > 0 && Number(v) < 100000 ? Number(v) : undefined);
      const sets = gallery.sets?.length ? gallery.sets : ["Highlights"];
      const item = {
        id: photoId, galleryId: id, key: keys.key, filename: upload.filename, setName: sets.includes(input.setName) ? input.setName : sets[0], size, contentType: upload.contentType,
        sortOrder: Number.isSafeInteger(Number(input.sortOrder)) ? Number(input.sortOrder) : Date.now(),
        createdAt: new Date().toISOString(), createdById: actor.sub,
      };
      if (display) item.displayKey = keys.displayKey;
      if (thumb) item.thumbKey = keys.thumbKey;
      if (dim(input.width)) item.width = dim(input.width);
      if (dim(input.height)) item.height = dim(input.height);
      await db.send(new PutCommand({ TableName: T.photos(), Item: item, ConditionExpression: "attribute_not_exists(id)" }));
      if (!gallery.coverPhotoId) {
        // first photo becomes the cover; the condition makes parallel uploads race-safe
        await db.send(new UpdateCommand({ TableName: T.galleries(), Key: { id }, UpdateExpression: "SET coverPhotoId = :p", ConditionExpression: "attribute_not_exists(coverPhotoId)", ExpressionAttributeValues: { ":p": photoId } }))
          .catch((e) => { if (e.name !== "ConditionalCheckFailedException") throw e; });
      }
      await audit(event, "PHOTO_UPLOADED", { galleryId: id, photoId });
      return json({ photo: { id: photoId, filename: item.filename } }, 201);
    }

    case "GET galleries/:id/activity": {
      const events = await auditOf(id, { limit: 1000 });
      return json({ events: events.map(({ ttl, ...e }) => e) });
    }

    case "PATCH photos/:id": {
      const names = {};
      const values = {};
      const sets = [];
      if (input.filename !== undefined) {
        const filename = validateUpload({ filename: input.filename, contentType: "image/jpeg", size: 1 })?.filename;
        if (!filename) throw new HttpError(400, "invalid-filename");
        names["#f"] = "filename"; values[":f"] = filename; sets.push("#f = :f");
      }
      if (input.setName !== undefined) {
        const setName = trim(input.setName, 60);
        if (!setName) throw new HttpError(400, "invalid-set");
        names["#s"] = "setName"; values[":s"] = setName; sets.push("#s = :s");
      }
      if (!sets.length) throw new HttpError(400, "nothing-to-update");
      const r = await db.send(new UpdateCommand({ TableName: T.photos(), Key: { id }, UpdateExpression: `SET ${sets.join(", ")}`, ConditionExpression: "attribute_exists(id)", ExpressionAttributeNames: names, ExpressionAttributeValues: values, ReturnValues: "ALL_NEW" }));
      return json({ photo: { id, filename: r.Attributes.filename, setName: r.Attributes.setName } });
    }

    case "DELETE photos/:id": {
      const photo = await getItem(T.photos(), id);
      if (!photo) throw new HttpError(404, "not-found");
      await deleteObjects(photoKeys(photo));
      await deletePhotoItems([id]);
      await db.send(new UpdateCommand({ TableName: T.galleries(), Key: { id: photo.galleryId }, UpdateExpression: "REMOVE coverPhotoId", ConditionExpression: "coverPhotoId = :p", ExpressionAttributeValues: { ":p": id } })).catch((e) => { if (e.name !== "ConditionalCheckFailedException") throw e; });
      await audit(event, "PHOTO_DELETED", { galleryId: photo.galleryId, photoId: id });
      return json({ ok: true });
    }

    default:
      throw new HttpError(404, "not-found");
  }
}

export async function handler(event) {
  try {
    const method = event.requestContext?.http?.method;
    const path = event.rawPath || event.requestContext?.http?.path || "/";
    if (method === "OPTIONS") return json({ ok: true });
    if (method === "GET" && path === "/version") return json({ version: process.env.APP_VERSION || "dev" });
    if (method === "GET" && path === "/download") return await download(event);
    if (path.startsWith("/galleries/")) {
      const parts = path.split("/").filter(Boolean);
      if (method === "GET") return await viewGallery(event, parts);
      if (method === "POST" && parts.at(-1) === "selection") return await submitSelection(event, parts);
      if (method === "POST" && parts.at(-1) === "downloads") return await archiveUrls(event, parts);
    }
    if (path.startsWith("/admin/")) return await admin(event, method, path);
    throw new HttpError(404, "not-found");
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.statusCode);
    if (error?.name === "ConditionalCheckFailedException") return json({ error: "not-found" }, 404);
    console.error(error);
    return json({ error: "server-error" }, 500);
  }
}
