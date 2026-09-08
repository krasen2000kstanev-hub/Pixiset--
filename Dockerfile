# syntax=docker/dockerfile:1
#
# Single-stage image kept deliberately simple: this is a low-traffic app and we
# want `prisma migrate` and `create-user` available inside the same container.

FROM node:22-slim
ENV NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json package-lock.json* ./
# Dev deps (prisma CLI, tsx, typescript) are needed for build + admin scripts.
RUN npm ci --include=dev

COPY . .
RUN npx prisma generate && npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
