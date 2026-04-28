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

describe('POST /v1/flashsale/purchase (e2e)', () => {
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
    // Grab the OTP code from the outbox payload (plain_code is stored there for worker delivery)
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

  async function createActiveItem(sku: string, stock: bigint, quantity: number) {
    const product = await prisma.product.create({
      data: { sku, name: sku, stock, priceCents: 1000n },
    });
    const { items } = await saleCreation.create({
      name: `Sale for ${sku}`,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 3_600_000),
      items: [{ productId: product.id, quantity, priceCents: 1000n }],
    });
    return { item: items[0], product };
  }

  it('missing Idempotency-Key → 400 idempotency_key_required', async () => {
    const token = await registerAndVerify('purchase-nokey@test.local');
    const { item } = await createActiveItem('NOKEY-SKU', 10n, 5);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/flashsale/purchase',
      headers: { authorization: `Bearer ${token}` },
      payload: { sale_item_id: item.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('idempotency_key_required');
  });

  it('happy path → 200 with correct shape', async () => {
    const token = await registerAndVerify('purchase-happy@test.local');
    await prisma.user.updateMany({
      where: { email: 'purchase-happy@test.local' },
      data: { balanceCents: 10_000n },
    });
    const { item } = await createActiveItem('HAPPY-SKU', 10n, 5);
    const key = '11111111-1111-1111-1111-111111111111';

    const res = await app.inject({
      method: 'POST',
      url: '/v1/flashsale/purchase',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
      payload: { sale_item_id: item.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ purchase_id: string; sale_item_id: string; price_cents: string; remaining_stock: number }>();
    expect(body.purchase_id).toBeDefined();
    expect(body.sale_item_id).toBe(item.id);
    expect(body.remaining_stock).toBe(4);
  });

  it('replay with same Idempotency-Key → identical 200, exactly 1 purchase row', async () => {
    const token = await registerAndVerify('purchase-idem@test.local');
    await prisma.user.updateMany({
      where: { email: 'purchase-idem@test.local' },
      data: { balanceCents: 10_000n },
    });
    const { item } = await createActiveItem('IDEM-SKU', 10n, 5);
    const key = '22222222-2222-2222-2222-222222222222';

    const inject = () =>
      app.inject({
        method: 'POST',
        url: '/v1/flashsale/purchase',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
        payload: { sale_item_id: item.id },
      });

    const r1 = await inject();
    const r2 = await inject();
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r1.json()).toEqual(r2.json());

    const count = await prisma.purchase.count({ where: { idempotencyKey: key } });
    expect(count).toBe(1);
  });

  it('sold_out → 409', async () => {
    const token = await registerAndVerify('purchase-soldout@test.local');
    await prisma.user.updateMany({
      where: { email: 'purchase-soldout@test.local' },
      data: { balanceCents: 10_000n },
    });
    const { item } = await createActiveItem('SOLDOUT-SKU', 1n, 1);

    // manually exhaust the item
    await prisma.flashSaleItem.update({ where: { id: item.id }, data: { sold: 1 } });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/flashsale/purchase',
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': '33333333-3333-3333-3333-333333333333',
      },
      payload: { sale_item_id: item.id },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('sold_out');
  });

  it('out_of_window → 409', async () => {
    const token = await registerAndVerify('purchase-window@test.local');
    await prisma.user.updateMany({
      where: { email: 'purchase-window@test.local' },
      data: { balanceCents: 10_000n },
    });

    const product = await prisma.product.create({
      data: { sku: 'WINDOW-SKU', name: 'Window', stock: 10n, priceCents: 1000n },
    });
    const { items } = await saleCreation.create({
      name: 'Ended Sale',
      startsAt: new Date(Date.now() - 7_200_000),
      endsAt: new Date(Date.now() - 3_600_000),
      items: [{ productId: product.id, quantity: 5, priceCents: 1000n }],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/flashsale/purchase',
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': '44444444-4444-4444-4444-444444444444',
      },
      payload: { sale_item_id: items[0].id },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('out_of_window');
  });

  it('insufficient_balance → 402', async () => {
    const token = await registerAndVerify('purchase-balance@test.local');
    // leave balance at 0 (default)
    const { item } = await createActiveItem('BALANCE-SKU', 10n, 5);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/flashsale/purchase',
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': '55555555-5555-5555-5555-555555555555',
      },
      payload: { sale_item_id: item.id },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().error.code).toBe('insufficient_balance');
  });

  it('already_purchased_today → 409 on second purchase same day', async () => {
    const token = await registerAndVerify('purchase-daily@test.local');
    await prisma.user.updateMany({
      where: { email: 'purchase-daily@test.local' },
      data: { balanceCents: 50_000n },
    });

    const { item: item1 } = await createActiveItem('DAILY-SKU-1', 10n, 5);
    const { item: item2 } = await createActiveItem('DAILY-SKU-2', 10n, 5);

    const r1 = await app.inject({
      method: 'POST',
      url: '/v1/flashsale/purchase',
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': '66666666-6666-6666-6666-666666666661',
      },
      payload: { sale_item_id: item1.id },
    });
    expect(r1.statusCode).toBe(200);

    const r2 = await app.inject({
      method: 'POST',
      url: '/v1/flashsale/purchase',
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': '66666666-6666-6666-6666-666666666662',
      },
      payload: { sale_item_id: item2.id },
    });
    expect(r2.statusCode).toBe(409);
    expect(r2.json().error.code).toBe('already_purchased_today');
  });
});
