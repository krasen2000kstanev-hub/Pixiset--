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
- `lookup()` falls back to a table scan until `slug-index` exists; remove the
  fallback once the stack update has been applied everywhere.

## Verification

- `npm test`: 31 tests (Lambda handler, validation, access, S3 keys, Next lib).
- `npx tsc --noEmit` passes.
- `docs/` was smoke-tested against a local mock API (gallery, lightbox, favorites,
  selection, password gate, admin list/detail/upload/settings/activity).
- CloudFormation change set previewed: no resource replacement.

## Known limits / next work

1. "Download all" downloads files one after another; a server-side ZIP is not built.
2. No email notifications (would need an SES IAM policy, which the deploy role cannot add).
3. No photo reordering UI (order = natural filename order at upload time).
4. No rate limiting on gallery passwords beyond API Gateway defaults.
5. Public routes are open to any origin the browser allows; CORS is limited to the
   GitHub Pages origin via the `AllowedOrigin` template parameter.
6. Old galleries' photos without `displayKey` fall back to the original in the lightbox.
