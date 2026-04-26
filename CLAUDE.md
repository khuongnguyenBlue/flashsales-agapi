# Working in this repo

This file orients future Claude sessions (and human collaborators) on how the
project is structured and how to work in it. Keep it short — the design spec
is the source of truth for *what*; this file is about *how*.

## Project intent

Backend take-home assignment: a NestJS service that delivers user
authentication (register/login/logout with OTP), a flash-sale system with
strict concurrency correctness, and async stock synchronization. Public repo
at https://github.com/khuongnguyenBlue/flashsales-agapi.

Timebox: 1 week. Optimize for **correctness, security, and clean module
boundaries** — not feature count.

## Status

Phase 1 (foundation) is mid-flight. Implementation plan tracks 33 tasks across
6 phases — see "Plan" link below.

## Where to find things

The design **spec** and **plan** are intentionally NOT committed to git
(`docs/` is in `.gitignore` so the public repo stays focused on code). They
live on disk locally:

- Spec: `docs/superpowers/specs/2026-04-24-flashsale-backend-design.md`
  — 12 sections covering goals, decisions, system context, deployment, key
  data flows, concurrency strategy, security, reliability, scaling, data
  model, and API surface. **The spec is the source of truth.** When in doubt,
  read it.
- Plan: `docs/superpowers/plans/2026-04-25-flashsale-backend-implementation.md`
  — 33 tasks, lean format (intent + files + acceptance criteria). Code shown
  only where the design is non-obvious (purchase tx, outbox SQL, sale-creation
  tx, idempotency interceptor, k6 script, Lua rate-limit).

## Commands

```bash
# Local dev
npm run start:dev:api          # API with watch mode
npm run start:dev:worker       # Worker with watch mode (after Task 13)

# Build / lint / format
npm run build
npm run lint
npm run format

# Tests
npm test                       # Unit tests (src/**/*.spec.ts)
npm run test:e2e               # E2E with Testcontainers (real Postgres + Redis)

# Prisma
npm run prisma:generate
npm run prisma:migrate:dev
npm run prisma:migrate:deploy
npm run prisma:seed            # (added in Task 30)

# Docker stack
docker compose up -d postgres redis      # infra only — fast
docker compose up                        # full stack (needs Tasks 13+ for worker)
docker compose down                      # stop
docker compose down -v                   # stop and wipe Postgres volume
```

## Architecture

Modular monolith with two entrypoints (API + async worker) sharing one
codebase. Postgres for durable state including a transactional outbox table;
Redis for rate limiting, OTP TTL, and refresh-token revocation. **Eager
reservation** for inventory (spec §5.5): `products.stock` is decremented
atomically at sale creation; purchases only mutate `flash_sale_items.sold` and
`users.balance_cents`.

Module boundaries (spec §3): each domain module exposes a service interface;
cross-module calls go through interfaces, never repositories. The purchase tx
is the only place multiple modules share a `Prisma.TransactionClient`.

## Conventions

- **TDD where it pays.** Write failing tests for services, repositories, and
  business-logic guards. Smoke checks for setup tasks (scaffolding, Docker)
  rather than fake unit tests.
- **No comments unless WHY is non-obvious.** Identifier names should carry
  the *what*. Comments are for hidden constraints, subtle invariants, and
  workarounds.
- **No backwards-compat shims.** When changing code, change it. No `// removed`
  notes or compatibility re-exports.
- **Lean implementations.** No premature abstraction, no error handling for
  scenarios that can't happen, no validation outside system boundaries.
- **Idempotency keys** on every write that can be retried. Cache responses,
  use deterministic dedup keys for outbox handlers.
- **Constants for tx timeouts** (spec §5.3): `statement_timeout=2s`,
  `lock_timeout=1s`, `idle_in_transaction_session_timeout=5s`. Set via
  `TransactionService.run()` in every business tx.

## Branching policy

- Phase 1 (foundation) commits go directly to `main` — greenfield bootstrap,
  nothing to branch from.
- Phase 2 onward: each phase on its own feature branch (`phase-2-shared-infra`,
  `phase-3-auth`, etc.), reviewed via PR before merging into `main`.
- Use `gh pr create` for PRs (gh is authenticated as `khuongnguyenBlue`).

## Things that bite

- **`docs/` is git-ignored.** Never `git add docs/`. The spec/plan stay local.
- **Prisma + raw SQL.** Use Prisma for schema/migrations and ordinary CRUD;
  drop to `$queryRaw` / `$executeRaw` only where explicit locks (`FOR UPDATE`,
  `SKIP LOCKED`) are needed (purchase tx, outbox claim, sale creation).
- **HS256 JWT for MVP.** Spec §7.1 calls for RS256; we sign with HS256 and use
  `JWT_PRIVATE_KEY_BASE64` as a shared secret. Switching to RS256 is a
  one-line change in `JwtModule.registerAsync` once we generate keys.
- **Two timezones.** Server runs in UTC (`timestamptz` everywhere); the
  per-user-per-day uniqueness key (`purchases.day`) is derived from
  `SERVER_TIMEZONE` (default `Asia/Ho_Chi_Minh`).
- **No partial UNIQUE on email/phone.** Postgres's default `NULLS DISTINCT`
  already permits multiple NULLs — plain `UNIQUE` is correct.
