import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { PrismaModule } from '../../src/shared/prisma/prisma.module';
import { TransactionModule } from '../../src/shared/transaction/transaction.module';
import { OutboxModule } from '../../src/shared/outbox/outbox.module';
import { FlashSaleModule } from '../../src/modules/flashsale/flashsale.module';
import { SaleCreationService } from '../../src/modules/flashsale/sale-creation.service';
import { startInfra, type InfraHandles } from '../helpers/testcontainers';

describe('SaleCreationService (e2e)', () => {
  let infra: InfraHandles;
  let service: SaleCreationService;
  let prisma: PrismaService;
  let moduleRef: { close(): Promise<void> };

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

    moduleRef = module;
    service = module.get(SaleCreationService);
    prisma = module.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await infra.shutdown();
  });

  async function createProduct(sku: string, stock: bigint) {
    return prisma.product.create({
      data: { sku, name: `Product ${sku}`, stock, priceCents: 100_00n },
    });
  }

  it('creates sale + items + reservations + outbox event', async () => {
    const product = await createProduct('SALE-TEST-1', 100n);

    const startsAt = new Date(Date.now() - 60_000);
    const endsAt = new Date(Date.now() + 3_600_000);

    const { sale, items } = await service.create({
      name: 'Test Sale',
      startsAt,
      endsAt,
      items: [{ productId: product.id, quantity: 10, priceCents: 50_00n }],
    });

    expect(sale.id).toBeDefined();
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(10);

    // stock decremented eagerly
    const updatedProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(updatedProduct.stock).toBe(90n);

    // outbox event appended
    const outboxRow = await prisma.outbox.findFirst({ where: { idempotencyKey: sale.id } });
    expect(outboxRow).toBeTruthy();
    expect(outboxRow!.type).toBe('flash_sale.created');
    expect(outboxRow!.status).toBe('PENDING');
  });

  it('throws on over-allocation; products.stock unchanged', async () => {
    const product = await createProduct('SALE-TEST-2', 5n);

    await expect(
      service.create({
        name: 'Oversell Sale',
        startsAt: new Date(Date.now() - 1000),
        endsAt: new Date(Date.now() + 3_600_000),
        items: [{ productId: product.id, quantity: 10, priceCents: 50_00n }],
      }),
    ).rejects.toThrow();

    const unchanged = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(unchanged.stock).toBe(5n);
  });

  it('concurrent allocations of the last unit: exactly one succeeds', async () => {
    const product = await createProduct('SALE-TEST-CONCURRENT', 1n);

    const makeInput = (suffix: string) => ({
      name: `Concurrent Sale ${suffix}`,
      startsAt: new Date(Date.now() - 1000),
      endsAt: new Date(Date.now() + 3_600_000),
      items: [{ productId: product.id, quantity: 1, priceCents: 50_00n }],
    });

    const results = await Promise.allSettled([
      service.create(makeInput('A')),
      service.create(makeInput('B')),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const finalProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(finalProduct.stock).toBe(0n);
  });
});
