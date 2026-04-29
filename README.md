# FlashSale Backend

A NestJS backend for a flash-sale system: user authentication with OTP, concurrent-safe inventory reservation, and async event processing via a transactional outbox.

Design spec and implementation plan live in `docs/superpowers/` (git-ignored; available locally).

---

## Prerequisites

- Docker and Docker Compose
- Node.js ≥ 20.10 (for running tests and the load test locally)

---

## Quick start

```bash
cp .env.example .env
docker compose up
```

The stack starts Postgres, Redis, runs migrations, then boots the API (`:3000`) and worker.

Seed demo data (5 products, 3 flash sales, 100 test users):

```bash
docker compose exec api npm run prisma:seed
```

---

## API walkthrough

### 1. Register

```bash
curl -s -X POST http://localhost:3000/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"you@example.com","password":"Passw0rd!"}' | jq
```

### 2. Get the OTP code

The worker logs the mock-sent code. Look for it:

```bash
docker compose logs worker | grep plain_code
```

### 3. Verify OTP and get tokens

```bash
curl -s -X POST http://localhost:3000/v1/auth/verify-otp \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"you@example.com","code":"<OTP_CODE>"}' | jq
# → { "accessToken": "...", "refreshToken": "..." }
```

### 4. List active flash sales

```bash
curl -s http://localhost:3000/v1/flashsale/active | jq
# → { "items": [...] }  — grab a sale_item_id from the active sale
```

Top up balance first (seeded test users already have balance; manual registrations start at 0):

```bash
# Using psql inside the container:
docker compose exec postgres psql -U flashsale -d flashsale \
  -c "UPDATE users SET balance_cents = 10000000 WHERE email = 'you@example.com';"
```

### 5. Purchase

```bash
TOKEN=<accessToken>
ITEM_ID=<sale_item_id>

curl -s -X POST http://localhost:3000/v1/flashsale/purchase \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Idempotency-Key: 00000000-0000-0000-0000-000000000001' \
  -d "{\"sale_item_id\":\"$ITEM_ID\"}" | jq
```

---

## Running tests

```bash
# Unit tests
npm test

# End-to-end tests (spins real Postgres + Redis via Testcontainers)
npm run test:e2e
```

---

## Load test

Requires [k6](https://k6.io/docs/get-started/installation/).

```bash
# 1. Start the stack
docker compose up -d

# 2. Seed and generate token file
npm run prisma:seed
npx tsx load/setup.ts   # writes load/tokens.json and prints SALE_ITEM_ID

# 3. Run
SALE_ITEM_ID=<id from step 2> k6 run load/purchase.js
```

Thresholds: `http_req_failed < 0.001`, `p(99) < 200ms`.

---

## Architecture

Modular monolith with two entrypoints — HTTP API and an async worker — sharing one codebase and one Postgres database. The API handles auth and flash-sale purchases; the worker drains a transactional outbox (Postgres) for reliable async side-effects (OTP delivery, downstream notifications). Redis handles rate limiting (token bucket, Lua), OTP TTL, and refresh-token revocation. Inventory uses **eager reservation** (Pattern B): `products.stock` is decremented atomically at sale creation; purchases only mutate `flash_sale_items.sold` and `users.balance_cents`, with per-row `FOR UPDATE` locking to prevent overselling and over-spending.

See the design spec (`docs/superpowers/specs/2026-04-24-flashsale-backend-design.md`) for the full rationale.

---

## Assumptions and non-goals

- Single-region deployment; no multi-master Postgres.
- OTP delivery is mocked (worker logs the code); real SMS/email integration is a one-function swap.
- Sale creation is admin-only — no HTTP endpoint, only the `SaleCreationService` used by the seeder and tests.
- HS256 JWT for MVP. Switching to RS256 requires generating a keypair and changing one line in `JwtModule.registerAsync`.
- No pagination on `GET /v1/flashsale/active` — acceptable at MVP scale.

---

## Evolution path

See spec §9 for the scaling roadmap: read replicas for the active-sales query, Redis sorted-set counters as a pre-filter before the DB purchase tx, CDN-cached sale catalogue, and Kafka/SQS to replace the outbox poller at higher outbox fan-out.
