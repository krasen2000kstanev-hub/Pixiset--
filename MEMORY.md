# Project memory

## Product

Client Gallery: private photo delivery system for photographers. The repo has
two implementations:

- `docs/` + `lambda/`: current lightweight AWS version.
- `src/` + `prisma/`: full Next.js/PostgreSQL version.

## Current AWS architecture

Static pages in `docs/` call API Gateway. API uses Cognito JWT auth for team
routes, Lambda, DynamoDB (`Galleries`, `Photos`, `Audit`) and private S3.
Public gallery reads and downloads use short-lived presigned S3 URLs.

Serverless gallery route is `/galleries/{proxy+}` so both gallery IDs and
`/galleries/slug/{slug}` reach Lambda.

## Recent fixes

- S3 object deletion uses `s3.send(DeleteObjectCommand)`, not the DynamoDB client.
- Added `package-lock.json`.
- Updated Next.js/Auth.js, Nanoid, AWS SDK and PostCSS dependencies.
- Added PostCSS override `8.5.23`.
- Added Lambda upload validation for image type, size and sanitized filename.
- Escaped API-controlled values before rendering them in static HTML.
- Improved client gallery UX: loading/empty states, Bulgarian labels, cover contrast,
  keyboard lightbox navigation, focus styles and mobile touch targets.
- Improved static admin UX: logout, search/status filters and client-side upload checks.
- Added static client selection tools: favorites filter, share/copy selection and Bulgarian lightbox actions.

## Verification

- 15/15 Vitest tests pass.
- `npx tsc --noEmit` passes.
- `node --check lambda/handler.mjs` passes.
- Production build passes.
- `npm audit --omit=dev --audit-level=high` reports 0 vulnerabilities.

## Known limits

Serverless version does not yet implement gallery passwords, favorites,
selection submission, email notifications or expiry dates. Those exist in the
Next.js version. Serverless deployment is not confirmed from this workspace.

## Recommended next work

1. Choose one source of truth: AWS serverless or Next.js.
2. Validate uploads server-side: MIME, size, filename and S3 key.
3. Remove API-data `innerHTML` from `docs/`; use DOM APIs or escaping.
4. Add AWS gallery gates, favorites and selection submission.
5. Replace DynamoDB scans with indexes and queries.
6. Add upload retry/cancel/preview, accessibility QA and Lambda handler tests.
7. Move API/Cognito values to deployment config; add rate limiting and alarms.
