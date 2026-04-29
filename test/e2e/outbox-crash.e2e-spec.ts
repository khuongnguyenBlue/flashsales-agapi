/**
 * Spec §6.4 concurrency tests #5 and #6: outbox crash recovery.
 *
 * Test #5 uses a raw pg.Client to simulate a worker crash:
 *   BEGIN → SELECT FOR UPDATE SKIP LOCKED → ROLLBACK
 * After ROLLBACK, Postgres releases the row locks synchronously.
 * Using Prisma's $disconnect() is unreliable here because Prisma waits for
 * the in-flight transaction to complete before closing connections, meaning
 * the transaction commits rather than aborts.
 *
 * Test #6 proves PROCESSED rows are not re-delivered on subsequent ticks.
 */
import { Client } from 'pg';
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

async function insertPendingRows(prisma: PrismaService, n: number): Promise<bigint[]> {
  const rows = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      prisma.outbox.create({
        data: {
          type: 'flash_sale.created',
          payload: { test: true, index: i },
          idempotencyKey: null,
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

    const rowIds = await insertPendingRows(prisma, 4);
    const rowIdStrings = rowIds.map(String);

    let callCount = 0;
    registry.register('flash_sale.created', async () => { callCount++; });

    // Simulate a crashed worker: open a raw pg connection, BEGIN a transaction,
    // claim the rows with FOR UPDATE SKIP LOCKED, then ROLLBACK (crash).
    // Using explicit ROLLBACK releases the locks synchronously — unlike
    // Prisma's $disconnect() which may let the transaction commit first.
    const crasher = new Client({ connectionString: infra.databaseUrl });
    await crasher.connect();
    await crasher.query('BEGIN');
    await crasher.query(
      `SELECT id FROM outbox WHERE id = ANY($1::bigint[]) FOR UPDATE SKIP LOCKED`,
      [rowIdStrings],
    );

    // Verify: another session sees 0 claimable rows (they are locked)
    const lockedRows = await prisma.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM outbox
      WHERE id = ANY(${rowIds}::bigint[]) AND status = 'PENDING'
      FOR UPDATE SKIP LOCKED
    `;
    expect(lockedRows).toHaveLength(0);

    // Crash: roll back the transaction → Postgres releases all row locks immediately
    await crasher.query('ROLLBACK');
    await crasher.end();

    // Recovery poller claims and processes all 4 rows
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
