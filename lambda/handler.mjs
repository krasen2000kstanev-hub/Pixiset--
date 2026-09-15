import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const json = (body, statusCode = 200) => ({ statusCode, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
const path = (event) => event.rawPath || event.requestContext?.http?.path || "/";
const body = (event) => event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body) : {};
const claims = (event) => event.requestContext?.authorizer?.jwt?.claims || {};
const requireTeam = (event) => { const c = claims(event); if (!c.sub) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 }); return c; };
const audit = async (event, action, data = {}) => db.send(new PutCommand({ TableName: process.env.AUDIT_TABLE, Item: { id: `${Date.now()}-${randomUUID()}`, action, actorId: claims(event).sub || null, createdAt: new Date().toISOString(), ...data } }));

export async function handler(event) {
  try {
    const p = path(event);
    if (event.requestContext?.http?.method === "OPTIONS") return json({ ok: true });

    if (event.requestContext?.http?.method === "GET" && p.startsWith("/galleries/")) {
      const id = p.split("/")[2];
      const result = await db.send(new GetCommand({ TableName: process.env.GALLERIES_TABLE, Key: { id } }));
      if (!result.Item || result.Item.status !== "PUBLISHED") return json({ error: "not-found" }, 404);
      const photos = await db.send(new QueryCommand({ TableName: process.env.PHOTOS_TABLE, IndexName: "galleryId-sortOrder-index", KeyConditionExpression: "galleryId = :g", ExpressionAttributeValues: { ":g": id } }));
      await audit(event, "CLIENT_VISIT", { galleryId: id });
      return json({ gallery: result.Item, photos: photos.Items || [] });
    }

    const actor = requireTeam(event);
    if (event.requestContext?.http?.method === "GET" && p === "/admin/galleries") {
      const result = await db.send(new QueryCommand({ TableName: process.env.GALLERIES_TABLE, IndexName: "createdById-updatedAt-index", KeyConditionExpression: "createdById = :u", ExpressionAttributeValues: { ":u": actor.sub } }));
      return json({ galleries: result.Items || [] });
    }
    if (event.requestContext?.http?.method === "POST" && p === "/admin/galleries") {
      const input = body(event); const id = randomUUID(); const item = { id, slug: input.slug || id, title: input.title, description: input.description || null, status: "DRAFT", createdById: actor.sub, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await db.send(new PutCommand({ TableName: process.env.GALLERIES_TABLE, Item: item })); await audit(event, "GALLERY_CREATED", { galleryId: id }); return json({ gallery: item }, 201);
    }
    if (event.requestContext?.http?.method === "POST" && p.match(/^\/admin\/galleries\/[^/]+\/upload$/)) {
      const galleryId = p.split("/")[3]; const input = body(event); const photoId = randomUUID(); const key = `originals/${galleryId}/${photoId}/${input.filename || "photo.jpg"}`;
      const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: process.env.PHOTO_BUCKET, Key: key, ContentType: input.contentType || "application/octet-stream" }), { expiresIn: 600 });
      await audit(event, "PHOTO_UPLOAD_URL_CREATED", { galleryId, photoId }); return json({ photoId, key, url });
    }
    return json({ error: "not-found" }, 404);
  } catch (error) { return json({ error: error.message || "server-error" }, error.statusCode || 500); }
}
