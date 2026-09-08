# Client Gallery

Собствена система за доставка на снимки на клиенти — аналог на Pixieset →
Client Gallery. Фотографът качва галерии, споделя ги по линк (± парола / имейл),
клиентите разглеждат, маркират любими, изпращат селекция и свалят снимки.
Всяко сваляне се записва.

> Това е самостоятелен продукт с еквивалентна функционалност — не съдържа код,
> дизайн или ресурси на Pixieset.

## Какво има вътре

| | |
|---|---|
| Admin панел | вход само за фотографа + колеги (без публична регистрация) |
| Галерии | заглавие, cover, акцентен цвят, оформление, чернова/публикувана |
| Достъп | опционална парола, опционален имейл, дата на изтичане |
| Качване | ресайз в браузъра → директно в S3 (thumb / display / оригинал) |
| Клиентска галерия | cover, justified грид, lightbox с клавиши |
| Любими | клиентът маркира и изпраща селекция с име/имейл/бележка |
| Сваляне | единично и „всички“, всяко със запис в базата |
| Активност | посещения, сваляния, селекции + CSV / списък с файлове |
| Имейли | AWS SES, per-gallery превключватели, скрити ако SES не е зададен |

## Технологии

Next.js 15 · TypeScript · Tailwind · Prisma · PostgreSQL · Auth.js ·
AWS S3 + CloudFront · AWS SES.

Хостинг по подразбиране: **един AWS Lightsail instance** с Docker Compose
(app + Postgres + Caddy за HTTPS). Виж [`infra/lightsail-setup.md`](infra/lightsail-setup.md).

---

## Локална разработка (Windows)

### 0. Предпоставки

```powershell
winget install OpenJS.NodeJS.LTS      # Node 20+ (сега липсва на машината)
winget install Docker.DockerDesktop   # за локален Postgres
```

Затвори и отвори терминала след инсталацията.

### 1. Инсталиране

```bash
npm install          # генерира и package-lock.json — комитни го
cp .env.example .env
```

Попълни в `.env` минимум:

- `AUTH_SECRET`, `NEXTAUTH_SECRET`, `GALLERY_ACCESS_SECRET` — генерирай всеки с
  `openssl rand -base64 32` (или `npx --yes nanoid` / произволен 32-байтов низ)
- `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- `S3_BUCKET`, `NEXT_PUBLIC_CDN_URL`

### 2. База данни

```bash
docker compose up -d db
npx prisma migrate dev --name init
npm run create-user -- --email you@studio.com --name "You"
```

### 3. Стартиране

```bash
npm run dev
```

- Admin: <http://localhost:3000/admin>
- Клиентска галерия: линкът се показва в admin панела след създаване на галерия

### 4. Тестове

```bash
npm test
```

---

## AWS – еднократна настройка

Подробности в `infra/`. Накратко:

1. **S3 bucket** (private). Приложи:
   - `infra/s3-cors.json` (замени домейна) — за presigned PUT от браузъра
   - `infra/s3-bucket-policy.json` — public read **само** за `cdn/*`
2. **IAM потребител** с `infra/iam-policy.json` → сложи ключовете в `.env`.
3. **CloudFront** пред bucket-а → `infra/cloudfront-setup.md`.
   `NEXT_PUBLIC_CDN_URL` = CloudFront домейнът.
4. **SES** (по избор) → `infra/ses-setup.md`. Без него имейлите са изключени.
5. **Lightsail** instance за приложението → `infra/lightsail-setup.md`.

---

## Как работи качването (без сървърна обработка на изображения)

1. Браузърът чете файла и прави `thumb` (≤600px) и `display` (≤2560px) с canvas.
2. Иска presigned PUT URL-и от `/api/admin/galleries/[id]/upload`.
3. PUT-ва трите версии директно в S3.
4. `/api/admin/galleries/[id]/photos` записва редовете в базата.

`originals/*` са частни (само presigned GET, всеки достъп се логва).
`cdn/*` (thumb + display) се сервират публично през CloudFront с кеш.

## Сваляне „всички“

Първата версия сваля файловете последователно от браузъра (presigned URL-и).
Работи навсякъде и не товари сървъра. За много големи галерии сървърен ZIP —
виж „Phase 2“ по-долу.

---

## Структура

```
src/
  app/
    (admin)/admin/…      вход, списък, редакция+качване, активност
    (client)/g/[slug]/…  cover, gate, грид, lightbox, любими, селекция
    api/admin/…          CRUD, presign, потвърждаване, активност/CSV
    api/g/[slug]/…        auth, favorites, favorites/submit, download, visit
  lib/                    db, auth, s3, access, mail, image-client, slug, justified
prisma/schema.prisma
infra/                    S3 / CloudFront / SES / Lightsail инструкции
tests/                    vitest: slug, access, s3, justified
```

## Добавяне на колеги (admin достъп)

```bash
npm run create-user -- --email colleague@studio.com --name "Colleague"
# или в продукция:
docker compose exec app npm run create-user -- --email colleague@studio.com --name "Colleague"
```

## Още по-евтина база (по избор): SQLite + Litestream

Смени `provider` в `prisma/schema.prisma` на `sqlite`, направи `notifyEmails` и
`photoIds` обикновени `String` (запетайки), и ползвай Litestream за нонстоп
бекъп към S3. Премахва Postgres контейнера. Виж коментара в schema.prisma.

## Качване в GitHub

Репото вече е инициализирано локално с първи комит. За да го качиш:

```bash
# 1. Създай ПРАЗНО repo в github.com (без README/gitignore/license)
# 2. После:
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

Или с GitHub CLI:

```bash
gh repo create <repo> --private --source=. --remote=origin --push
```

`.env` е в `.gitignore` и няма да се качи — дръж секретите извън repo-то.
След първото `npm install` комитни и `package-lock.json` (нужен за CI).
CI (`.github/workflows/ci.yml`) прави typecheck + тестове + build при всеки push.

## Phase 2 (не е включено)

Сървърен ZIP за големи галерии · watermark · няколко теми · брой прегледи
per-снимка · PWA · поддомейн per-галерия · rate limiting · миграция към RDS.
