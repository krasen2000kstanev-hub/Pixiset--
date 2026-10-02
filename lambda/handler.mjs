import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const json = (body, statusCode = 200) => ({ statusCode, headers: { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,authorization", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS" }, body: JSON.stringify(body) });
const path = (event) => event.rawPath || event.requestContext?.http?.path || "/";
const body = (event) => event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body) : {};
const claims = (event) => event.requestContext?.authorizer?.jwt?.claims || {};
const requireTeam = (event) => { const c = claims(event); if (!c.sub) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 }); return c; };
const audit = async (event, action, data = {}) => db.send(new PutCommand({ TableName: process.env.AUDIT_TABLE, Item: { id: `${Date.now()}-${randomUUID()}`, action, actorId: claims(event).sub || null, createdAt: new Date().toISOString(), ...data } }));

export async function handler(event) {
  try {
    const p = path(event);
    if (event.requestContext?.http?.method === "OPTIONS") return json({ ok: true });
    if (event.requestContext?.http?.method === "GET" && p === "/download") { const key = event.queryStringParameters?.key; if (!key || !key.startsWith("originals/")) return json({ error: "invalid-key" }, 400); const found = await db.send(new ScanCommand({ TableName: process.env.PHOTOS_TABLE, FilterExpression: "#k = :k", ExpressionAttributeNames: { "#k": "key" }, ExpressionAttributeValues: { ":k": key }, ProjectionExpression: "galleryId, #k" })); const photo = found.Items?.[0]; if (!photo) return json({ error: "not-found" }, 404); const gallery = await db.send(new GetCommand({ TableName: process.env.GALLERIES_TABLE, Key: { id: photo.galleryId } })); if (gallery.Item?.status !== "PUBLISHED") return json({ error: "not-found" }, 404); const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.PHOTO_BUCKET, Key: key, ResponseContentDisposition: "attachment" }), { expiresIn: 300 }); return json({ url }); }

    if (event.requestContext?.http?.method === "GET" && p.startsWith("/galleries/")) {
      const id = p.split("/")[2];
      const result = p.startsWith("/galleries/slug/") ? await db.send(new ScanCommand({ TableName: process.env.GALLERIES_TABLE, FilterExpression: "slug = :s", ExpressionAttributeValues: { ":s": decodeURIComponent(p.split("/")[3] || "") } })) : await db.send(new GetCommand({ TableName: process.env.GALLERIES_TABLE, Key: { id } }));
      const galleryItem = result.Item || result.Items?.[0];
      if (!galleryItem || galleryItem.status !== "PUBLISHED") return json({ error: "not-found" }, 404);
      const photos = await db.send(new QueryCommand({ TableName: process.env.PHOTOS_TABLE, IndexName: "galleryId-sortOrder-index", KeyConditionExpression: "galleryId = :g", ExpressionAttributeValues: { ":g": galleryItem.id } }));
      await audit(event, "CLIENT_VISIT", { galleryId: galleryItem.id });
      const visiblePhotos = await Promise.all((photos.Items || []).map(async photo => ({ ...photo, url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.PHOTO_BUCKET, Key: photo.key }), { expiresIn: 900 }) })));
      return json({ gallery: galleryItem, photos: visiblePhotos });
    }

    const actor = requireTeam(event);
    if (event.requestContext?.http?.method === "GET" && p === "/admin/galleries") {
      const result = await db.send(new QueryCommand({ TableName: process.env.GALLERIES_TABLE, IndexName: "createdById-updatedAt-index", KeyConditionExpression: "createdById = :u", ExpressionAttributeValues: { ":u": actor.sub } }));
      const galleries = await Promise.all((result.Items || []).map(async gallery => {
        const photos = await db.send(new QueryCommand({ TableName: process.env.PHOTOS_TABLE, IndexName: "galleryId-sortOrder-index", KeyConditionExpression: "galleryId = :g", ExpressionAttributeValues: { ":g": gallery.id }, ProjectionExpression: "id, #s", ExpressionAttributeNames: { "#s": "size" } }));
        return { ...gallery, photoCount: (photos.Items || []).length, photoBytes: (photos.Items || []).reduce((n, photo) => n + (Number(photo.size) || 0), 0) };
      }));
      return json({ galleries });
    }
    if (event.requestContext?.http?.method === "GET" && p.match(/^\/admin\/galleries\/[^/]+\/photos$/)) {
      const galleryId = p.split("/")[3];
      const result = await db.send(new QueryCommand({ TableName: process.env.PHOTOS_TABLE, IndexName: "galleryId-sortOrder-index", KeyConditionExpression: "galleryId = :g", ExpressionAttributeValues: { ":g": galleryId } }));
      const photos = await Promise.all((result.Items || []).map(async photo => ({ ...photo, url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.PHOTO_BUCKET, Key: photo.key }), { expiresIn: 900 }) })));
      return json({ photos });
    }
    if (event.requestContext?.http?.method === "POST" && p === "/admin/galleries") {
      const input = body(event); const id = randomUUID(); const item = { id, slug: input.slug || id, title: input.title, description: input.description || null, sets: ["Highlights"], status: "DRAFT", createdById: actor.sub, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await db.send(new PutCommand({ TableName: process.env.GALLERIES_TABLE, Item: item })); await audit(event, "GALLERY_CREATED", { galleryId: id }); return json({ gallery: item }, 201);
    }
    if (event.requestContext?.http?.method === "PATCH" && p.match(/^\/admin\/galleries\/[^/]+$/)) {
      const galleryId = p.split("/")[3]; const input = body(event);
      const expression = input.status ? "SET #st = :st, updatedAt = :u" : input.slug ? "SET slug = :s, updatedAt = :u" : input.sets ? "SET sets = :s, updatedAt = :u" : "SET coverPhotoId = :c, updatedAt = :u";
      const values = input.status ? { ":st": input.status, ":u": new Date().toISOString() } : input.slug ? { ":s": input.slug, ":u": new Date().toISOString() } : input.sets ? { ":s": input.sets, ":u": new Date().toISOString() } : { ":c": input.coverPhotoId, ":u": new Date().toISOString() };
      const names = input.status ? { "#st": "status" } : undefined;
      const result = await db.send(new UpdateCommand({ TableName: process.env.GALLERIES_TABLE, Key: { id: galleryId }, UpdateExpression: expression, ExpressionAttributeNames: names, ExpressionAttributeValues: values, ReturnValues: "ALL_NEW" }));
      await audit(event, "GALLERY_COVER_CHANGED", { galleryId, photoId: input.coverPhotoId }); return json({ gallery: result.Attributes });
    }
    if (event.requestContext?.http?.method === "POST" && p.match(/^\/admin\/galleries\/[^/]+\/upload$/)) {
      const galleryId = p.split("/")[3]; const input = body(event); const photoId = randomUUID(); const key = `originals/${galleryId}/${photoId}/${input.filename || "photo.jpg"}`;
      const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: process.env.PHOTO_BUCKET, Key: key, ContentType: input.contentType || "application/octet-stream" }), { expiresIn: 600 });
      await db.send(new PutCommand({ TableName: process.env.PHOTOS_TABLE, Item: { id: photoId, galleryId, key, filename: input.filename || "photo.jpg", setName: input.setName || "Highlights", size: Number(input.size) || 0, contentType: input.contentType || "application/octet-stream", sortOrder: Date.now(), createdAt: new Date().toISOString(), createdById: actor.sub } }));
      await audit(event, "PHOTO_UPLOAD_URL_CREATED", { galleryId, photoId }); return json({ photoId, key, url });
    }
    if (event.requestContext?.http?.method === "PATCH" && p.match(/^\/admin\/photos\/[^/]+$/)) {
      const photoId = p.split("/")[3]; const input = body(event); const names = []; if (input.filename) names.push("filename = :f"); if (input.setName) names.push("setName = :s");
      if (!names.length) return json({ error: "nothing-to-update" }, 400); const values = {}; if (input.filename) values[":f"] = input.filename; if (input.setName) values[":s"] = input.setName;
      const result = await db.send(new UpdateCommand({ TableName: process.env.PHOTOS_TABLE, Key: { id: photoId }, UpdateExpression: `SET ${names.join(", ")}`, ExpressionAttributeValues: values, ReturnValues: "ALL_NEW" })); return json({ photo: result.Attributes });
    }
    if (event.requestContext?.http?.method === "DELETE" && p.match(/^\/admin\/photos\/[^/]+$/)) { const photoId = p.split("/")[3]; await db.send(new DeleteCommand({ TableName: process.env.PHOTOS_TABLE, Key: { id: photoId } })); return json({ ok: true }); }
    return json({ error: "not-found" }, 404);
  } catch (error) { return json({ error: error.message || "server-error" }, error.statusCode || 500); }
}
