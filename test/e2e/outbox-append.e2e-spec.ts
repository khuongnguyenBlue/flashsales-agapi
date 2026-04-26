import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { OutboxModule } from '../../src/shared/outbox/outbox.module';
import { OutboxService } from '../../src/shared/outbox/outbox.service';
import { PrismaModule } from '../../src/shared/prisma/prisma.module';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { TransactionModule } from '../../src/shared/transaction/transaction.module';
import { TransactionService } from '../../src/shared/transaction/transaction.service';
import { startInfra, type InfraHandles } from '../helpers/testcontainers';

describe('OutboxService.append (e2e)', () => {
  let infra: InfraHandles;
  let prisma: PrismaService;
  let tx: TransactionService;
  let outbox: OutboxService;

  beforeAll(async () => {
    infra = await startInfra();
    process.env.DATABASE_URL = infra.databaseUrl;

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        TransactionModule,
        OutboxModule,
      ],
    }).compile();

    prisma = module.get(PrismaService);
    tx = module.get(TransactionService);
    outbox = module.get(OutboxService);
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
    await infra.shutdown();
  });

  it('appends outbox row and user in same tx; both visible after commit', async () => {
    const email = `outbox-test-${Date.now()}@example.com`;

    await tx.run(async (client) => {
      const user = await client.user.create({ data: { email, passwordHash: 'hash' } });
      await outbox.append(client, {
        type: 'otp.send',
        payload: { userId: user.id, channel: 'EMAIL' },
        idempotencyKey: user.id,
      });
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const row = await prisma.outbox.findFirstOrThrow({
      where: { idempotencyKey: user.id },
    });

    expect(row.type).toBe('otp.send');
    expect(row.status).toBe('PENDING');
  });
});
