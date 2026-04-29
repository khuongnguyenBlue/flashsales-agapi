/**
 * Spec §6.4 concurrency test #8: concurrent sale allocations of the last unit.
 */
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { PrismaModule } from '../../src/shared/prisma/prisma.module';
import { TransactionModule } from '../../src/shared/transaction/transaction.module';
import { OutboxModule } from '../../src/shared/outbox/outbox.module';
import { FlashSaleModule } from '../../src/modules/flashsale/flashsale.module';
import { SaleCreationService } from '../../src/modules/flashsale/sale-creation.service';
import { startInfra, type InfraHandles } from '../helpers/testcontainers';

describe('Sale creation concurrency (spec §6.4 test #8)', () => {
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

  it('#8 concurrent allocation of last unit: exactly one succeeds, products.stock = 0', async () => {
    const product = await prisma.product.create({
      data: { sku: 'CONCURRENT-ALLOC-SKU', name: 'Last Unit', stock: 1n, priceCents: 1000n },
    });

    const makeInput = (suffix: string) => ({
      name: `Race Sale ${suffix}`,
      startsAt: new Date(Date.now() - 1000),
      endsAt: new Date(Date.now() + 3_600_000),
      items: [{ productId: product.id, quantity: 1, priceCents: 1000n }],
    });

    const results = await Promise.allSettled([
      service.create(makeInput('A')),
      service.create(makeInput('B')),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const final = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(final.stock).toBe(0n);
  });
});
