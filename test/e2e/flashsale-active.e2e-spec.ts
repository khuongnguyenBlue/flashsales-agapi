import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaModule } from '../../src/shared/prisma/prisma.module';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { TransactionModule } from '../../src/shared/transaction/transaction.module';
import { OutboxModule } from '../../src/shared/outbox/outbox.module';
import { AppErrorFilter } from '../../src/shared/http/error.filter';
import { FlashSaleModule } from '../../src/modules/flashsale/flashsale.module';
import { SaleCreationService } from '../../src/modules/flashsale/sale-creation.service';
import { startInfra, type InfraHandles } from '../helpers/testcontainers';

describe('GET /v1/flashsale/active (e2e)', () => {
  let infra: InfraHandles;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let saleCreation: SaleCreationService;

  beforeAll(async () => {
    infra = await startInfra();
    process.env.DATABASE_URL = infra.databaseUrl;
    process.env.REDIS_URL = infra.redisUrl;

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        TransactionModule,
        OutboxModule,
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

    // Seed 3 products and 3 sales: past, current, future
    const p1 = await prisma.product.create({ data: { sku: 'ACTIVE-P1', name: 'P1', stock: 100n, priceCents: 1000n } });
    const p2 = await prisma.product.create({ data: { sku: 'ACTIVE-P2', name: 'P2', stock: 100n, priceCents: 2000n } });
    const p3 = await prisma.product.create({ data: { sku: 'ACTIVE-P3', name: 'P3', stock: 100n, priceCents: 3000n } });

    const now = Date.now();
    await saleCreation.create({
      name: 'Past Sale',
      startsAt: new Date(now - 7_200_000),
      endsAt: new Date(now - 3_600_000),
      items: [{ productId: p1.id, quantity: 10, priceCents: 500n }],
    });
    await saleCreation.create({
      name: 'Current Sale',
      startsAt: new Date(now - 300_000),
      endsAt: new Date(now + 3_600_000),
      items: [
        { productId: p2.id, quantity: 20, priceCents: 1000n },
        { productId: p3.id, quantity: 30, priceCents: 1500n },
      ],
    });
    await saleCreation.create({
      name: 'Future Sale',
      startsAt: new Date(now + 3_600_000),
      endsAt: new Date(now + 7_200_000),
      items: [{ productId: p1.id, quantity: 5, priceCents: 200n }],
    });
  });

  afterAll(async () => {
    await app.close();
    await infra.shutdown();
  });

  it('returns only active sale items with correct shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/flashsale/active' });
    expect(res.statusCode).toBe(200);

    const { items } = res.json<{ items: unknown[] }>();
    expect(items).toHaveLength(2); // Current Sale has 2 items

    const item = (items as Array<Record<string, unknown>>)[0];
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('product');
    expect(item).toHaveProperty('price_cents');
    expect(item).toHaveProperty('quantity');
    expect(item).toHaveProperty('sold');
    expect(item).toHaveProperty('remaining');
    expect(item).toHaveProperty('window');
    expect((item.window as Record<string, unknown>).name).toBe('Current Sale');
  });

  it('respects ?at= query param', async () => {
    // Past sale window — should return 1 item
    const pastAt = new Date(Date.now() - 5_400_000).toISOString(); // 1.5h ago
    const res = await app.inject({ method: 'GET', url: `/v1/flashsale/active?at=${pastAt}` });
    expect(res.statusCode).toBe(200);
    const { items } = res.json<{ items: unknown[] }>();
    expect(items).toHaveLength(1);
  });
});
