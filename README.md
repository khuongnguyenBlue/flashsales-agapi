# FlashSale Backend

A NestJS + Fastify backend for a flash-sale system: user authentication with OTP, concurrent-safe inventory purchasing, and reliable async event processing via a transactional outbox.

→ **[Design document](docs/DESIGN.md)** — architecture, data model, API reference, concurrency strategy, tradeoffs, and evolution path.

---

## Prerequisites

- Docker and Docker Compose
- Node.js ≥ 20.10 (for tests and the load test)

---

## Quick start

```bash
cp .env.example .env
docker compose up
```

The stack starts Postgres, Redis, runs migrations, then boots the API (`:3000`) and worker. Seed demo data (5 products, 3 flash sales, 100 test users):

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

The worker logs the mock-sent code:

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
# grab a sale_item_id from the response
```

Seeded test users start with 50,000,000 cents balance. For manually registered users, top up via:

```bash
docker compose exec postgres psql -U flashsale -d flashsale \
  -c "UPDATE users SET balance_cents = 50000000 WHERE email = 'you@example.com';"
```

### 5. Purchase

```bash
TOKEN=<accessToken>
ITEM_ID=<sale_item_id>

curl -s -X POST http://localhost:3000/v1/flashsale/purchase \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Idempotency-Key: 00000000-0000-4000-8000-000000000001' \
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

The e2e suite covers all 9 concurrency scenarios from the design spec: oversell prevention, daily cap races, balance integrity, idempotency, outbox crash recovery, duplicate delivery prevention, convergence, inventory invariant, and stock isolation.

---

## Load test

Requires [k6](https://k6.io/docs/get-started/installation/).

```bash
# 1. Enable rate-limit bypass for bulk login (setup only)
#    Set RATE_LIMIT_DISABLED=true in .env, then restart:
docker compose up -d

# 2. Seed and generate token file
docker compose exec api npm run prisma:seed
npx tsx load/setup.ts        # writes load/tokens.json, prints SALE_ITEM_ID

# 3. Reset rate limiting for production-accurate results
#    Set RATE_LIMIT_DISABLED=false in .env, then restart:
docker compose up -d

# 4. Run
SALE_ITEM_ID=<id from step 2> k6 run load/purchase.js
```

Thresholds: `http_req_failed < 0.001`, `p(99) < 200ms`.

### Results

Scenario: ramp to 500 req/s over 20s, sustain 60s, ramp down 10s — against `POST /v1/flashsale/purchase`.

```
  █ THRESHOLDS

    http_req_duration  ✓  p(99)<200    p(99)=6.64ms
    http_req_failed    ✓  rate<0.001   rate=0.00%

  █ TOTAL RESULTS

    checks_succeeded : 100.00%  37,999 / 37,999   (✓ is 2xx or 409)

    http_req_duration : avg=1.97ms  p(90)=2.05ms  p(95)=2.81ms  p(99)=6.64ms  max=123ms
    http_req_failed   : 0.00%    (0 / 37,999)
    http_reqs         : 37,999   @ 422 req/s

    data_received : 39 MB  (438 kB/s)
    data_sent     : 20 MB  (222 kB/s)
```

> 409 responses (`sold_out` / `already_purchased_today`) are counted as success — they are the expected outcome once stock is exhausted or a user has already purchased that day.

---

## Architecture summary

Modular monolith with two entrypoints (API + async worker) sharing one Postgres database. Inventory uses **eager reservation**: `products.stock` is decremented atomically at sale creation; purchases only mutate `flash_sale_items.sold` and `users.balance_cents`, with `FOR UPDATE` row locks to prevent overselling.

The transactional outbox pattern guarantees that every committed purchase produces a downstream event — no message broker required at this scale.

See [docs/DESIGN.md](docs/DESIGN.md) for the full treatment.
