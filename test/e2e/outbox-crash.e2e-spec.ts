/**
 * Spec §6.4 concurrency tests #5 and #6: outbox crash recovery.
 *
 * Tests use two Prisma clients on the same DB to simulate two separate
 * connections — one acting as the "crashed worker" (claims rows then
 * disconnects without committing), one acting as the recovery poller.
 *
 * When the crasher disconnects, Postgres rolls back its open transaction
 * and releases the FOR UPDATE SKIP LOCKED locks, making the rows available
 * to the next poll.
 */
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../src/shared/prisma/prisma.module';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { HandlerRegistry } from '../../src/worker/handler-registry';
import { OutboxPoller } from '../../src/worker/outbox-poller';
import { startInfra, type InfraHandles } from '../helpers/testcontainers';

const WORKER_ENV = {
  OUTBOX_POLL_INTERVAL_MS: '50',
  OUTBOX_BATCH_SIZE: '10',
  OUTBOX_MAX_ATTEMPTS: '5',
};

async function buildPollerModule(databaseUrl: string, redisUrl: string) {
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redisUrl;

  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      PrismaModule,
    ],
    providers: [HandlerRegistry, OutboxPoller],
  }).compile();

  return module;
}

async function insertPendingRows(prisma: PrismaService | PrismaClient, n: number): Promise<bigint[]> {
  const rows = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      (prisma as PrismaClient).outbox.create({
        data: {
          type: 'flash_sale.created',
          payload: { test: true, index: i },
          idempotencyKey: `crash-test-${Date.now()}-${i}`,
        },
        select: { id: true },
      }),
    ),
  );
  return rows.map((r) => r.id);
}

describe('OutboxPoller crash recovery (spec §6.4 tests #5, #6)', () => {
  let infra: InfraHandles;

  beforeAll(async () => {
    infra = await startInfra();
    Object.assign(process.env, WORKER_ENV);
  });

  afterAll(async () => {
    await infra.shutdown();
  });

  it('#5 no lost events: rows claimed in aborted tx are re-claimed after crash', async () => {
    const module = await buildPollerModule(infra.databaseUrl, infra.redisUrl);
    const prisma = module.get(PrismaService);
    const registry = module.get(HandlerRegistry);
    const poller = module.get(OutboxPoller);

    // Insert 4 rows to be "lost" by the crash
    const rowIds = await insertPendingRows(prisma, 4);

    // Count calls to prove delivery
    let callCount = 0;
    registry.register('flash_sale.created', async () => { callCount++; });

    // Simulate crash: a second client opens a tx, claims the rows, then disconnects
    // without committing — Postgres rolls back and releases the locks.
    const crasher = new PrismaClient({ datasourceUrl: infra.databaseUrl });
    try {
      // We intentionally start a transaction that we'll abort by disconnecting.
      // The promise won't resolve normally — we race it with a disconnect.
      const txPromise = crasher.$transaction(async (client) => {
        // Claim all pending rows
        await client.$queryRaw`
          SELECT id FROM outbox
          WHERE id = ANY(${rowIds}::bigint[])
          FOR UPDATE SKIP LOCKED
        `;
        // Hold the lock while we verify SKIP LOCKED from another session
        await new Promise((r) => setTimeout(r, 200));
      });

      // Give the tx a moment to acquire locks
      await new Promise((r) => setTimeout(r, 50));

      // Verify: poller sees 0 claimable rows for these ids while crasher holds locks
      const lockedRows = await prisma.$queryRaw<Array<{ id: bigint }>>`
        SELECT id FROM outbox
        WHERE id = ANY(${rowIds}::bigint[]) AND status = 'PENDING'
        FOR UPDATE SKIP LOCKED
      `;
      expect(lockedRows).toHaveLength(0);

      // Crash the connection — aborts the open tx, releasing all locks
      await crasher.$disconnect();
      await txPromise.catch(() => {}); // suppress expected disconnect error
    } catch {
      await crasher.$disconnect();
    }

    // Give Postgres a moment to clean up the abandoned connection
    await new Promise((r) => setTimeout(r, 100));

    // Recovery poller picks up all 4 rows
    await poller.tick();

    expect(callCount).toBe(4);
    const processed = await prisma.outbox.findMany({
      where: { id: { in: rowIds }, status: 'PROCESSED' },
    });
    expect(processed).toHaveLength(4);

    await module.close();
  });

  it('#6 no duplicate delivery: PROCESSED rows skipped on subsequent ticks', async () => {
    const module = await buildPollerModule(infra.databaseUrl, infra.redisUrl);
    const prisma = module.get(PrismaService);
    const registry = module.get(HandlerRegistry);
    const poller = module.get(OutboxPoller);

    const rowIds = await insertPendingRows(prisma, 3);

    let callCount = 0;
    registry.register('flash_sale.created', async () => { callCount++; });

    // First tick processes all 3 rows
    await poller.tick();
    expect(callCount).toBe(3);

    const afterFirst = await prisma.outbox.findMany({
      where: { id: { in: rowIds } },
      select: { id: true, status: true },
    });
    expect(afterFirst.every((r) => r.status === 'PROCESSED')).toBe(true);

    // Second tick — no PENDING rows remain; handler must not be called again
    await poller.tick();
    expect(callCount).toBe(3); // unchanged

    await module.close();
  });
});
