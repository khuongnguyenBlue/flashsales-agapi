import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../../src/shared/prisma/prisma.module';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { TransactionModule } from '../../src/shared/transaction/transaction.module';
import { HandlerRegistry } from '../../src/worker/handler-registry';
import { FlashSaleSettleHandler } from '../../src/worker/handlers/flash-sale-settle.handler';
import { startInfra, type InfraHandles } from '../helpers/testcontainers';

describe('FlashSaleSettleHandler (e2e)', () => {
  let infra: InfraHandles;
  let prisma: PrismaService;
  let handler: FlashSaleSettleHandler;

  beforeAll(async () => {
    infra = await startInfra();
    process.env.DATABASE_URL = infra.databaseUrl;

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        TransactionModule,
      ],
      providers: [HandlerRegistry, FlashSaleSettleHandler],
    }).compile();

    prisma = module.get(PrismaService);
    handler = module.get(FlashSaleSettleHandler);
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
    await infra.shutdown();
  });

  afterEach(async () => {
    await prisma.purchase.deleteMany();
    await prisma.flashSaleItem.deleteMany();
    await prisma.flashSale.deleteMany();
    await prisma.product.deleteMany();
  });

  async function createProduct(stock: bigint) {
    return prisma.product.create({
      data: { sku: `sku-${Date.now()}-${Math.random()}`, name: 'Test Product', stock, priceCents: 1000n },
    });
  }

  async function createEndedSale(items: Array<{ productId: string; quantity: number; sold: number }>) {
    const sale = await prisma.flashSale.create({
      data: {
        name: 'Ended Sale',
        startsAt: new Date(Date.now() - 2 * 3_600_000),
        endsAt: new Date(Date.now() - 3_600_000),
      },
    });
    for (const item of items) {
      await prisma.flashSaleItem.create({
        data: {
          flashSaleId: sale.id,
          productId: item.productId,
          quantity: item.quantity,
          sold: item.sold,
          priceCents: 1000n,
        },
      });
    }
    return sale;
  }

  it('returns unsold units to product stock', async () => {
    const product = await createProduct(0n);
    const sale = await createEndedSale([{ productId: product.id, quantity: 100, sold: 30 }]);

    await handler.handle({ flash_sale_id: sale.id });

    const updated = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(updated.stock).toBe(70n);

    const settled = await prisma.flashSale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(settled.settledAt).not.toBeNull();
  });

  it('is idempotent — second invocation does not double-add stock', async () => {
    const product = await createProduct(0n);
    const sale = await createEndedSale([{ productId: product.id, quantity: 100, sold: 40 }]);

    await handler.handle({ flash_sale_id: sale.id });
    await handler.handle({ flash_sale_id: sale.id });

    const updated = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(updated.stock).toBe(60n);
  });

  it('handles fully-sold sale — no stock added, settled_at still set', async () => {
    const product = await createProduct(0n);
    const sale = await createEndedSale([{ productId: product.id, quantity: 100, sold: 100 }]);

    await handler.handle({ flash_sale_id: sale.id });

    const updated = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(updated.stock).toBe(0n);

    const settled = await prisma.flashSale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(settled.settledAt).not.toBeNull();
  });

  it('settles multiple items within a single sale correctly', async () => {
    const p1 = await createProduct(0n);
    const p2 = await createProduct(0n);
    const sale = await createEndedSale([
      { productId: p1.id, quantity: 100, sold: 25 },
      { productId: p2.id, quantity: 50, sold: 50 },
    ]);

    await handler.handle({ flash_sale_id: sale.id });

    const u1 = await prisma.product.findUniqueOrThrow({ where: { id: p1.id } });
    const u2 = await prisma.product.findUniqueOrThrow({ where: { id: p2.id } });
    expect(u1.stock).toBe(75n);
    expect(u2.stock).toBe(0n);
  });
});
