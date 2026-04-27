import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../../src/shared/prisma/prisma.module';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { HandlerRegistry } from '../../src/worker/handler-registry';
import { OutboxPoller } from '../../src/worker/outbox-poller';
import { startInfra, type InfraHandles } from '../helpers/testcontainers';

const testEnv = {
  OUTBOX_POLL_INTERVAL_MS: '9999999',
  OUTBOX_BATCH_SIZE: '10',
  OUTBOX_MAX_ATTEMPTS: '3',
};

describe('OutboxPoller (e2e)', () => {
  let infra: InfraHandles;
  let prisma: PrismaService;
  let poller: OutboxPoller;
  let registry: HandlerRegistry;

  beforeAll(async () => {
    infra = await startInfra();
    process.env.DATABASE_URL = infra.databaseUrl;
    Object.assign(process.env, testEnv);

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
      ],
      providers: [HandlerRegistry, OutboxPoller],
    }).compile();

    prisma = module.get(PrismaService);
    poller = module.get(OutboxPoller);
    registry = module.get(HandlerRegistry);
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    poller.stop();
    await prisma.onModuleDestroy();
    await infra.shutdown();
  });

  afterEach(async () => {
    await prisma.outbox.deleteMany();
    await prisma.user.deleteMany();
  });

  it('PENDING row → PROCESSED after one tick with no-op handler', async () => {
    registry.register('otp.send', async () => undefined);

    const user = await prisma.user.create({ data: { email: 'poller@test.com', passwordHash: 'x' } });
    await prisma.outbox.create({
      data: { type: 'otp.send', payload: { userId: user.id } },
    });

    await poller.tick();

    const row = await prisma.outbox.findFirst({ where: { type: 'otp.send' } });
    expect(row?.status).toBe('PROCESSED');
  });

  it('failing handler → DEAD_LETTER after maxAttempts ticks', async () => {
    registry.register('purchase.completed', async () => {
      throw new Error('handler fail');
    });

    const user = await prisma.user.create({ data: { email: 'dead@test.com', passwordHash: 'x' } });
    await prisma.outbox.create({
      data: { type: 'purchase.completed', payload: { userId: user.id } },
    });

    // maxAttempts = 3: tick 3 times to exhaust retries
    await poller.tick();
    await prisma.outbox.updateMany({ data: { visibleAt: new Date(0) } });
    await poller.tick();
    await prisma.outbox.updateMany({ data: { visibleAt: new Date(0) } });
    await poller.tick();

    const row = await prisma.outbox.findFirst({ where: { type: 'purchase.completed' } });
    expect(row?.status).toBe('DEAD_LETTER');
    expect(row?.attempts).toBe(3);
  });
});
