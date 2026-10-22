# Graph Report - Pixiset--  (2026-10-22)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 322 nodes · 615 edges · 18 communities (14 shown, 4 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `62269617`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- validation.ts
- package.json
- db.ts
- GalleryView.tsx
- s3.ts
- GalleryEditor.tsx
- auth.ts
- compilerOptions
- auth/route.ts
- next
- dependencies
- devDependencies
- activity/page.tsx
- slug.ts
- next.config.mjs
- { GET, POST }

## God Nodes (most connected - your core abstractions)
1. `requireAdmin()` - 19 edges
2. `prisma` - 18 edges
3. `errorResponse()` - 17 edges
4. `compilerOptions` - 16 edges
5. `next` - 15 edges
6. `HttpError` - 13 edges
7. `gateGallery()` - 13 edges
8. `scripts` - 13 edges
9. `GalleryView()` - 12 edges
10. `GalleryEditor()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `GalleryEditPage()` --calls--> `GalleryEditor()`  [EXTRACTED]
  src/app/(admin)/admin/galleries/[id]/page.tsx → src/app/(admin)/admin/galleries/[id]/GalleryEditor.tsx
- `GalleryEditPage()` --calls--> `publicUrl()`  [EXTRACTED]
  src/app/(admin)/admin/galleries/[id]/page.tsx → src/lib/s3.ts
- `POST()` --calls--> `presignDownload()`  [EXTRACTED]
  src/app/api/g/[slug]/download/route.ts → src/lib/s3.ts
- `POST()` --calls--> `gateGallery()`  [EXTRACTED]
  src/app/api/g/[slug]/favorites/route.ts → src/lib/gallery-access.ts
- `GalleryPage()` --calls--> `gateGallery()`  [EXTRACTED]
  src/app/(client)/g/[slug]/page.tsx → src/lib/gallery-access.ts

## Import Cycles
- None detected.

## Communities (18 total, 4 thin omitted)

### Community 0 - "validation.ts"
Cohesion: 0.09
Nodes (37): @aws-sdk/client-sesv2, dynamic, GalleryEditPage(), Ctx, POST(), webFilename(), Ctx, POST() (+29 more)

### Community 1 - "package.json"
Cohesion: 0.05
Nodes (37): name, prisma, seed, private, scripts, build, create-user, db:deploy (+29 more)

### Community 2 - "db.ts"
Cohesion: 0.18
Nodes (24): csvCell(), Ctx, GET(), Ctx, DELETE(), Ctx, PATCH(), POST() (+16 more)

### Community 3 - "GalleryView.tsx"
Cohesion: 0.11
Nodes (19): react, LoginForm(), LoginPage(), metadata, downloadAll(), triggerDownload(), ClientPhoto, Cover() (+11 more)

### Community 4 - "s3.ts"
Cohesion: 0.12
Nodes (16): @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, vitest, COPY, GalleryClosed(), Gate(), dynamic, GalleryPage() (+8 more)

### Community 5 - "GalleryEditor.tsx"
Cohesion: 0.13
Nodes (20): CoverLayout, DangerZone(), DownloadSize, Field(), GalleryEditor(), onFiles(), PhotoLite, Settings (+12 more)

### Community 6 - "auth.ts"
Cohesion: 0.14
Nodes (15): next-auth, zod, AdminLayout(), auth, authConfig, credsSchema, handlers, signIn (+7 more)

### Community 7 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 8 - "auth/route.ts"
Cohesion: 0.24
Nodes (11): nanoid, Ctx, POST(), ACCESS_TTL_SECONDS, accessCookieName(), SECRET, signAccess(), verifyAccess() (+3 more)

### Community 9 - "next"
Cohesion: 0.18
Nodes (6): next, NewGalleryButton(), AdminHome(), dynamic, metadata, metadata

### Community 10 - "dependencies"
Cohesion: 0.15
Nodes (13): dependencies, @aws-sdk/client-s3, @aws-sdk/client-sesv2, @aws-sdk/s3-request-presigner, bcryptjs, jose, nanoid, next (+5 more)

### Community 11 - "devDependencies"
Cohesion: 0.17
Nodes (12): devDependencies, autoprefixer, postcss, prisma, tailwindcss, tsx, @types/bcryptjs, @types/node (+4 more)

### Community 12 - "activity/page.tsx"
Cohesion: 0.39
Nodes (8): ActivityPage(), dynamic, Empty(), fmt(), Section(), shortUA(), Stat(), Table()

### Community 13 - "slug.ts"
Cohesion: 0.48
Nodes (4): CYRILLIC, slugify(), suffix, uniqueSlug()

## Knowledge Gaps
- **11 isolated node(s):** `autoprefixer`, `postcss`, `prisma`, `react-dom`, `tsx` (+6 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 140 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `next` to `validation.ts`, `package.json`, `GalleryView.tsx`, `s3.ts`, `GalleryEditor.tsx`, `auth.ts`, `auth/route.ts`, `activity/page.tsx`?**
  _High betweenness centrality (0.186) - this node is a cross-community bridge._
- **What connects `autoprefixer`, `postcss`, `prisma` to the rest of the system?**
  _11 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `validation.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0851063829787234 - nodes in this community are weakly interconnected._
- **Why does `react` connect `GalleryView.tsx` to `package.json`, `s3.ts`, `GalleryEditor.tsx`, `next`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.04983388704318937 - nodes in this community are weakly interconnected._
- **Why does `prisma` connect `db.ts` to `validation.ts`, `s3.ts`, `auth.ts`, `auth/route.ts`, `next`, `activity/page.tsx`?**
  _High betweenness centrality (0.072) - this node is a cross-community bridge._
- **Should `GalleryView.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.10967741935483871 - nodes in this community are weakly interconnected._