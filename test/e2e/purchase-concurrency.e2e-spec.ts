/**
 * Spec §6.4 concurrency tests: 1 (no oversell), 2 (daily cap), 3 (balance),
 * 4 (idempotency), 7 (convergence), 9 (stock invariant).
 */
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppErrorFilter } from '../../src/shared/http/error.filter';
import { OutboxModule } from '../../src/shared/outbox/outbox.module';
import { PrismaModule } from '../../src/shared/prisma/prisma.module';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { RedisModule } from '../../src/shared/redis/redis.module';
import { TransactionModule } from '../../src/shared/transaction/transaction.module';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { FlashSaleModule } from '../../src/modules/flashsale/flashsale.module';
import { SaleCreationService } from '../../src/modules/flashsale/sale-creation.service';
import { startInfra, type InfraHandles } from '../helpers/testcontainers';

const ENV = {
  BCRYPT_COST: '4',
  OTP_TTL_SECONDS: '300',
  JWT_PRIVATE_KEY_BASE64: 'Zmxhc2hzYWxlLW12cC1zZWNyZXQtMzItY2hhcnMtbWluaW11bSE=',
  JWT_PUBLIC_KEY_BASE64: 'Zmxhc2hzYWxlLW12cC1zZWNyZXQtMzItY2hhcnMtbWluaW11bSE=',
  JWT_ACCESS_TTL_SECONDS: '900',
  JWT_REFRESH_TTL_SECONDS: '604800',
  SERVER_TIMEZONE: 'UTC',
};

describe('Purchase concurrency (spec §6.4)', () => {
  let infra: InfraHandles;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let saleCreation: SaleCreationService;

  beforeAll(async () => {
    infra = await startInfra();
    process.env.DATABASE_URL = infra.databaseUrl;
    process.env.REDIS_URL = infra.redisUrl;
    Object.assign(process.env, ENV);

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        RedisModule,
        TransactionModule,
        OutboxModule,
        AuthModule,
        FlashSaleModule,
      ],
    }).compile();

    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AppErrorFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = module.get(PrismaService);
    saleCreation = module.get(SaleCreationService);
  });

  afterAll(async () => {
    await app.close();
    await infra.shutdown();
  });

  async function registerAndVerify(identifier: string): Promise<string> {
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { identifier, password: 'Passw0rd!' },
    });
    const outboxRow = await prisma.outbox.findFirstOrThrow({
      where: { type: 'otp.send', payload: { path: ['identifier'], equals: identifier } },
      orderBy: { id: 'desc' },
    });
    const plain_code = (outboxRow.payload as { plain_code: string }).plain_code;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify-otp',
      payload: { identifier, code: plain_code },
    });
    return res.json<{ accessToken: string }>().accessToken;
  }

  async function createActiveItem(sku: string, stock: bigint, quantity: number, priceCents = 1000n) {
    const product = await prisma.product.create({
      data: { sku, name: sku, stock, priceCents },
    });
    const { items } = await saleCreation.create({
      name: `Sale ${sku}`,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 3_600_000),
      items: [{ productId: product.id, quantity, priceCents }],
    });
    return { item: items[0], product };
  }

  function purchaseReq(token: string, saleItemId: string, idemKey: string) {
    return app.inject({
      method: 'POST',
      url: '/v1/flashsale/purchase',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': idemKey },
      payload: { sale_item_id: saleItemId },
    });
  }

  // ─── Test #1 + #9 ─────────────────────────────────────────────────────────

  it('#1 no oversell: 10 concurrent purchases of a quantity=1 item → exactly 1 success, 9 sold_out', async () => {
    const tokens = await Promise.all(
      Array.from({ length: 10 }, (_, i) => registerAndVerify(`oversell-u${i}@test.local`)),
    );
    await prisma.user.updateMany({
      where: { email: { startsWith: 'oversell-u' } },
      data: { balanceCents: 100_000n },
    });

    const { item } = await createActiveItem('NOSELL-SKU', 1n, 1);

    const results = await Promise.all(
      tokens.map((token, i) =>
        purchaseReq(token, item.id, `11111111-1111-1111-1111-1111111100${String(i).padStart(2, '0')}`),
      ),
    );

    const successes = results.filter((r) => r.statusCode === 200);
    const soldOuts = results.filter(
      (r) => r.statusCode === 409 && r.json<{ error: { code: string } }>().error.code === 'sold_out',
    );
    expect(successes).toHaveLength(1);
    expect(soldOuts).toHaveLength(9);

    const updatedItem = await prisma.flashSaleItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updatedItem.sold).toBe(1);
  });

  it('#9 stock invariant: purchases never touch products.stock', async () => {
    // Use a fresh item with stock=5, quantity=3
    const { item, product } = await createActiveItem('STOCK-INVARIANT-SKU', 5n, 3);

    // products.stock was decremented by sale creation (eager reservation)
    const stockAfterReservation = (
      await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
    ).stock;
    expect(stockAfterReservation).toBe(2n); // 5 - 3 = 2

    const token = await registerAndVerify('stock-inv@test.local');
    await prisma.user.updateMany({
      where: { email: 'stock-inv@test.local' },
      data: { balanceCents: 100_000n },
    });

    await purchaseReq(token, item.id, 'stock-inv-key-0000-000000000001');

    // products.stock must be unchanged after purchase
    const stockAfterPurchase = (
      await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
    ).stock;
    expect(stockAfterPurchase).toBe(stockAfterReservation);
  });

  // ─── Test #2 ──────────────────────────────────────────────────────────────

  it('#2 daily cap: 1 user × 10 concurrent purchases of different items → exactly 1 success, 9 already_purchased_today', async () => {
    const token = await registerAndVerify('dailycap@test.local');
    await prisma.user.updateMany({
      where: { email: 'dailycap@test.local' },
      data: { balanceCents: 1_000_000n },
    });

    // 10 items in different sales so the user can attempt each
    const items = await Promise.all(
      Array.from({ length: 10 }, (_, i) => createActiveItem(`DAILYCAP-SKU-${i}`, 10n, 5)),
    );

    const results = await Promise.all(
      items.map(({ item }, i) =>
        purchaseReq(token, item.id, `22222222-2222-2222-2222-2222222200${String(i).padStart(2, '0')}`),
      ),
    );

    const successes = results.filter((r) => r.statusCode === 200);
    const alreadyPurchased = results.filter(
      (r) =>
        r.statusCode === 409 &&
        r.json<{ error: { code: string } }>().error.code === 'already_purchased_today',
    );
    expect(successes).toHaveLength(1);
    expect(alreadyPurchased).toHaveLength(9);

    const user = await prisma.user.findFirstOrThrow({ where: { email: 'dailycap@test.local' } });
    const purchaseCount = await prisma.purchase.count({ where: { userId: user.id } });
    expect(purchaseCount).toBe(1);
  });

  // ─── Test #3 ──────────────────────────────────────────────────────────────

  it('#3 balance: insufficient balance → 402; after top-up → 200', async () => {
    const token = await registerAndVerify('balance-check@test.local');
    // balance = 0 by default
    const { item } = await createActiveItem('BALANCE-CHECK-SKU', 10n, 5, 5000n);

    const r1 = await purchaseReq(token, item.id, '33333333-3333-3333-3333-333333333301');
    expect(r1.statusCode).toBe(402);
    expect(r1.json<{ error: { code: string } }>().error.code).toBe('insufficient_balance');

    // Verify balance unchanged
    const user = await prisma.user.findFirstOrThrow({ where: { email: 'balance-check@test.local' } });
    expect(user.balanceCents).toBe(0n);

    // Top up and retry with a fresh idempotency key
    await prisma.user.update({ where: { id: user.id }, data: { balanceCents: 100_000n } });

    const r2 = await purchaseReq(token, item.id, '33333333-3333-3333-3333-333333333302');
    expect(r2.statusCode).toBe(200);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.balanceCents).toBe(100_000n - 5000n);
  });

  // ─── Test #4 ──────────────────────────────────────────────────────────────

  it('#4 idempotency: same Idempotency-Key twice → identical 200, exactly 1 purchase row', async () => {
    const token = await registerAndVerify('idem-check@test.local');
    await prisma.user.updateMany({
      where: { email: 'idem-check@test.local' },
      data: { balanceCents: 100_000n },
    });
    const { item } = await createActiveItem('IDEM-CHECK-SKU', 10n, 5);
    const key = '44444444-4444-4444-4444-444444444444';

    const r1 = await purchaseReq(token, item.id, key);
    const r2 = await purchaseReq(token, item.id, key);

    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r1.json()).toEqual(r2.json());

    const count = await prisma.purchase.count({ where: { idempotencyKey: key } });
    expect(count).toBe(1);
  });

  // ─── Test #7 ──────────────────────────────────────────────────────────────

  it('#7 convergence: outbox has exactly as many purchase.completed events as committed purchases', async () => {
    const token = await registerAndVerify('convergence@test.local');
    await prisma.user.updateMany({
      where: { email: 'convergence@test.local' },
      data: { balanceCents: 100_000n },
    });
    const { item } = await createActiveItem('CONV-SKU', 10n, 5);
    const key = '77777777-7777-7777-7777-777777777777';

    const res = await purchaseReq(token, item.id, key);
    expect(res.statusCode).toBe(200);

    // Exactly 1 purchase committed → exactly 1 purchase.completed outbox row
    const pendingCount = await prisma.outbox.count({
      where: { type: 'purchase.completed', idempotencyKey: key, status: 'PENDING' },
    });
    expect(pendingCount).toBe(1);
  });
});
