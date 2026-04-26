# syntax=docker/dockerfile:1.7

# --- Stage 1: install all deps (incl. dev) for the build step
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- Stage 2: compile TypeScript
# (Prisma client generation is added in Task 3 once prisma/schema.prisma exists.)
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Stage 3: lean runtime image with prod deps + compiled output
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
# Default command — overridden per service in docker-compose.yml
CMD ["node", "dist/main.api.js"]
