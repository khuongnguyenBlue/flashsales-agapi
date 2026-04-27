import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../../src/shared/prisma/prisma.module';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { TransactionModule } from '../../src/shared/transaction/transaction.module';
import { TransactionService } from '../../src/shared/transaction/transaction.service';
import { startInfra, type InfraHandles } from '../helpers/testcontainers';

describe('TransactionService (e2e)', () => {
  let infra: InfraHandles;
  let tx: TransactionService;
  let prisma: PrismaService;

  beforeAll(async () => {
    infra = await startInfra();
    process.env.DATABASE_URL = infra.databaseUrl;

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        TransactionModule,
      ],
    }).compile();

    prisma = module.get(PrismaService);
    tx = module.get(TransactionService);
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
    await infra.shutdown();
  });

  it('sets the three guard timeouts inside the transaction', async () => {
    type Row = { name: string; setting: string };
    const rows = await tx.run((client) =>
      client.$queryRaw<Row[]>`
        SELECT name, setting
        FROM pg_settings
        WHERE name IN ('statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout')
      `,
    );

    const map = Object.fromEntries(rows.map((r) => [r.name, Number(r.setting)]));
    expect(map['statement_timeout']).toBe(2000);
    expect(map['lock_timeout']).toBe(1000);
    expect(map['idle_in_transaction_session_timeout']).toBe(5000);
  });

  it('rolls back on throw', async () => {
    await expect(
      tx.run(async (client) => {
        await client.user.create({ data: { email: 'rollback@test.com', passwordHash: 'x' } });
        throw new Error('intentional rollback');
      }),
    ).rejects.toThrow('intentional rollback');

    const count = await prisma.user.count({ where: { email: 'rollback@test.com' } });
    expect(count).toBe(0);
  });
});
