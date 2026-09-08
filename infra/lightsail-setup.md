# Deploy on AWS Lightsail (cheapest predictable option)

One small Lightsail instance runs the Next.js app + Postgres + Caddy (HTTPS)
via Docker Compose. S3 holds the photos; CloudFront caches the resized ones.

**Rough cost:** Lightsail 2 GB instance ≈ $12/mo (1 GB ≈ $7/mo but tight for
`next build`), S3 + CloudFront a few $/mo depending on volume, SES ≈ $0.

## 1. Create the instance

- Lightsail → Create instance → Linux → **Ubuntu 24.04**
- Plan: **2 GB RAM / 2 vCPU** (or 1 GB and build the image via GitHub Actions)
- Open firewall ports **80** and **443** (Networking tab)
- Attach a **static IP** and point your domain's `A` record at it

## 2. Install Docker

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
sudo usermod -aG docker ubuntu && newgrp docker
```

## 3. Get the code + configure

```bash
git clone <your-repo> client-gallery && cd client-gallery
cp .env.example .env
nano .env     # fill everything; APP_URL=https://your-domain.com
```

Set in `.env` for production:

```
APP_URL=https://your-domain.com
NEXT_PUBLIC_APP_URL=https://your-domain.com
DATABASE_URL=postgresql://gallery:STRONGPASS@db:5432/gallery?schema=public
POSTGRES_PASSWORD=STRONGPASS
NEXT_PUBLIC_CDN_URL=https://dXXXX.cloudfront.net
DOMAIN=your-domain.com
```

## 4. Start

```bash
docker compose up -d --build
docker compose exec app npx prisma migrate deploy
docker compose exec app npm run create-user -- --email you@studio.com --name "You"
```

Caddy fetches a Let's Encrypt certificate for `DOMAIN` automatically.

## 5. Add colleagues

```bash
docker compose exec app npm run create-user -- --email colleague@studio.com --name "Colleague"
```

## 6. Backups (nightly pg_dump → S3)

`crontab -e`:

```
15 3 * * * cd /home/ubuntu/client-gallery && docker compose exec -T db pg_dump -U gallery gallery | gzip | aws s3 cp - s3://YOUR-BUCKET/backups/db-$(date +\%F).sql.gz
```

(Install the AWS CLI, or run the dump into a local folder and sync it.)

## Updating

```bash
git pull && docker compose up -d --build
docker compose exec app npx prisma migrate deploy
```
