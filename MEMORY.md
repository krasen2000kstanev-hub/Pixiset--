# Project memory

## Product

Client Gallery: private photo delivery system for photographers. The repo has
two implementations:

- `docs/` + `lambda/` + `infra/serverless.yml`: the **live** lightweight AWS version
  (GitHub Pages + API Gateway + Lambda + Cognito + DynamoDB + private S3).
- `src/` + `prisma/`: the older full Next.js/PostgreSQL version. Not deployed;
  candidate for deletion.

## Current AWS architecture

Static pages in `docs/` are ES modules (`config.js`, `common.js`, `upload.js`,
`admin.js`, `gallery.js`) on one stylesheet (`site.css`). They call API Gateway.
Team routes (`/admin/*`) use a Cognito JWT authorizer. Public routes:
`GET /galleries/{id}`, `GET /galleries/slug/{slug}`, `POST /galleries/{id}/selection`,
`GET /download?id=`, `GET /version`.

Deploy: pushing to branch `client-gallery` runs `.github/workflows/release.yml`
(SAM deploy to stack `pixiset-gallery`, us-east-1, then GitHub Pages from `docs/`).
The deploy role `pixiset-github-actions` has `PowerUserAccess`: it **cannot change
IAM**, so keep `serverless.yml` free of new IAM roles/policies.

GitHub presents this repo's OIDC subject with immutable IDs:
`repo:krasen2000kstanev-hub@323143824/Pixiset--@1361371202:ref:refs/heads/client-gallery`.
The role's trust policy must match that string exactly (CloudTrail
`AssumeRoleWithWebIdentity` AccessDenied events show the real `sub`). A job that uses
`environment:` gets `...:environment:<name>` instead, so the AWS job has no environment.

## Data model (DynamoDB, on-demand)

- Galleries: `id`, `slug` (unique, `slug-index`), `title`, `description`, `displayDate`,
  `status` DRAFT|PUBLISHED, `sets[]`, `coverPhotoId`, `downloadEnabled`,
  `passwordHash` (scrypt `salt:hash`), `expiresAt` (YYYY-MM-DD).
- Photos: `id`, `galleryId`, `key` (original, private), `thumbKey`, `displayKey`,
  `filename`, `setName`, `size`, `width`, `height`, `sortOrder`.
- Audit (TTL 2 years, `galleryId-createdAt-index`): `CLIENT_VISIT`, `DOWNLOAD`,
  `SELECTION`, `GALLERY_*`, `PHOTO_*` with IP and user agent.

## Behaviour decisions

- Originals are never put in public responses. Clients get `thumb` and `display`
  presigned URLs; originals only via `/download?id=` which checks status, expiry,
  password, `downloadEnabled`, and writes an audit event.
- Uploads: browser makes thumb (640px) + display (2048px), PUTs all three to S3 with
  presigned URLs, then confirms; the API `HeadObject`s the files before creating the
  row, so there are no phantom photos. First photo becomes the cover automatically.
- Cognito: Authorization Code + PKCE (no implicit grant), `AllowAdminCreateUserOnly`.
  Team = every user of the pool; add colleagues in the Cognito console.
- All team members see all galleries (shared workspace).
- `lookup()` / `auditOf()` fall back to a table scan until `slug-index` and
  `galleryId-createdAt-index` exist; remove the fallbacks once the stack update is live.
- ZIP is built **in the visitor's browser** (`docs/zip.js`, `docs/archive.js`): the API
  only returns presigned original URLs (`POST /galleries/{ref}/downloads`, one audit
  event). Chromium streams one ZIP to a file the visitor picks; other browsers get
  parts of at most 500 MB. No server compute, no IAM changes. Store-only ZIP, no ZIP64.
- Manual order: `POST /admin/galleries/{id}/order {order:[ids]}`. The given photos keep
  the *slots* they occupy and are refilled in the new order (`planReorder`), so a
  per-set reorder never moves other sets' photos. New uploads get an epoch-ms
  `sortOrder` and therefore land at the end.
- Public gallery responses are paged (800 photos, `nextCursor`); the page loops until done.
- Abuse limits per IP and gallery (from the audit table): 8 wrong passwords / 10 min,
  10 selections / h, 20 archive requests / h.
- Deleting a gallery removes everything under `originals|thumbs|display/{id}/`, including
  uploads whose row was never created.
- Admin access tokens refresh silently with the Cognito refresh token (sessionStorage).
- Tests never touch AWS: `handler.mjs` exports `__useAws()` and the flow tests inject
  in-memory DynamoDB/S3 fakes. Do not use `vi.mock` for the SDK: the Lambda resolves its
  own copy from `lambda/node_modules`, so module mocks silently miss.

## Verification

- `npm test`: 57 tests (Lambda unit + 18 handler flows on in-memory fakes, ZIP format
  read back by an independent parser, archive planning, Next lib).
- `npx tsc --noEmit` passes.
- `docs/` smoke-tested in a browser against a local mock API: gallery, lightbox,
  favorites, selection, password gate, both ZIP modes (CRC-checked), admin list/detail,
  upload, settings, activity, reorder by arrows and drag & drop, per-set reorder.
- CloudFormation change set previewed: no resource replacement.

## Known limits / next work

1. ZIP of very large galleries depends on the visitor's browser and connection; there
   is no server-built archive (it would need an SQS/S3-event worker and IAM changes).
2. No email notifications (would need an SES IAM policy, which the deploy role cannot add).
3. Reordering is limited to the photos currently shown in the admin grid ("show more" first
   to move a photo beyond the first 60).
4. Photos from the first app version have no `displayKey` (and some no `thumbKey`). The public
   API uses `displayKey || thumbKey || key`, so the original is served only when a photo has
   no rendition at all. The admin gallery shows a "Стари снимки" panel; its button
   (`upgradePhotos` in `docs/upload.js`) fetches each original, makes thumb + display in the
   browser, PUTs them via `POST /admin/photos/{id}/renditions` and confirms with
   `PATCH /admin/photos/{id} {renditions:true,width,height}`. Run it once per old gallery.
5. One API response per gallery page contains presigned URLs for 800 photos; galleries
   above ~20 000 photos would need server-side filtering by set.
