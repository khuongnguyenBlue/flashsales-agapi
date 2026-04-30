import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CryptoModule } from '../../src/shared/crypto/crypto.module';
import { OtpCryptoService } from '../../src/shared/crypto/otp-crypto.service';
import { PrismaModule } from '../../src/shared/prisma/prisma.module';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { HandlerRegistry } from '../../src/worker/handler-registry';
import { OtpSendHandler } from '../../src/worker/handlers/otp-send.handler';
import { OutboxPoller } from '../../src/worker/outbox-poller';
import { startInfra, type InfraHandles } from '../helpers/testcontainers';

const testEnv = {
  OUTBOX_POLL_INTERVAL_MS: '9999999',
  OUTBOX_BATCH_SIZE: '10',
  OUTBOX_MAX_ATTEMPTS: '3',
  OTP_ENCRYPTION_KEY: 'a'.repeat(64),
};

describe('OtpSendHandler (e2e)', () => {
  let infra: InfraHandles;
  let prisma: PrismaService;
  let poller: OutboxPoller;
  let crypto: OtpCryptoService;

  beforeAll(async () => {
    infra = await startInfra();
    process.env.DATABASE_URL = infra.databaseUrl;
    Object.assign(process.env, testEnv);

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        CryptoModule,
      ],
      providers: [HandlerRegistry, OutboxPoller, OtpSendHandler],
    }).compile();

    prisma = module.get(PrismaService);
    poller = module.get(OutboxPoller);
    crypto = module.get(OtpCryptoService);
    await prisma.onModuleInit();
    await module.init(); // triggers OtpSendHandler.onModuleInit → registers handler
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

  it('PENDING otp.send row → otp.sent=true + outbox=PROCESSED', async () => {
    const user = await prisma.user.create({ data: { email: 'otp@test.com', passwordHash: 'x' } });
    const otp = await prisma.otpCode.create({
      data: {
        userId: user.id,
        channel: 'EMAIL',
        encryptedCode: crypto.encrypt('123456'),
        expiresAt: new Date(Date.now() + 300_000),
      },
    });
    await prisma.outbox.create({
      data: {
        type: 'otp.send',
        payload: { otp_id: otp.id, channel: 'EMAIL', identifier: 'otp@test.com' },
      },
    });

    await poller.tick();

    const updatedOtp = await prisma.otpCode.findUnique({ where: { id: otp.id } });
    expect(updatedOtp!.sent).toBe(true);

    const row = await prisma.outbox.findFirst({ where: { type: 'otp.send' } });
    expect(row!.status).toBe('PROCESSED');
  });

  it('replay on already-sent OTP → no-op, outbox=PROCESSED', async () => {
    const user = await prisma.user.create({ data: { email: 'otp2@test.com', passwordHash: 'x' } });
    const otp = await prisma.otpCode.create({
      data: {
        userId: user.id,
        channel: 'EMAIL',
        encryptedCode: crypto.encrypt('654321'),
        expiresAt: new Date(Date.now() + 300_000),
        sent: true, // already sent
      },
    });
    await prisma.outbox.create({
      data: {
        type: 'otp.send',
        payload: { otp_id: otp.id, channel: 'EMAIL', identifier: 'otp2@test.com' },
      },
    });

    await poller.tick();

    const row = await prisma.outbox.findFirst({ where: { type: 'otp.send' } });
    expect(row!.status).toBe('PROCESSED');

    // sent flag unchanged
    const unchanged = await prisma.otpCode.findUnique({ where: { id: otp.id } });
    expect(unchanged!.sent).toBe(true);
  });
});
