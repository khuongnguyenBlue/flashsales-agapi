import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { AppErrorFilter } from '../../src/shared/http/error.filter';
import { PrismaModule } from '../../src/shared/prisma/prisma.module';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { RedisModule } from '../../src/shared/redis/redis.module';
import { startInfra, type InfraHandles } from '../helpers/testcontainers';

describe('POST /v1/auth/register (e2e)', () => {
  let infra: InfraHandles;
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    infra = await startInfra();
    process.env.DATABASE_URL = infra.databaseUrl;
    process.env.REDIS_URL = infra.redisUrl;
    process.env.BCRYPT_COST = '4';
    process.env.OTP_TTL_SECONDS = '300';
    process.env.OTP_ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.JWT_PRIVATE_KEY_BASE64 = 'Zmxhc2hzYWxlLW12cC1zZWNyZXQtMzItY2hhcnMtbWluaW11bSE=';
    process.env.JWT_PUBLIC_KEY_BASE64 = 'Zmxhc2hzYWxlLW12cC1zZWNyZXQtMzItY2hhcnMtbWluaW11bSE=';
    process.env.JWT_ACCESS_TTL_SECONDS = '900';
    process.env.JWT_REFRESH_TTL_SECONDS = '604800';

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        RedisModule,
        AuthModule,
      ],
    }).compile();

    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalFilters(new AppErrorFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = module.get(PrismaService);
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await app.close();
    await infra.shutdown();
  });

  afterEach(async () => {
    await prisma.outbox.deleteMany();
    await prisma.user.deleteMany();
  });

  it('new identifier → 201, creates user + OTP + outbox row', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { identifier: 'alice@example.com', password: 'Password1' },
    });

    expect(res.statusCode).toBe(201);
    const { userId } = res.json<{ userId: string }>();
    expect(typeof userId).toBe('string');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user!.status).toBe('PENDING_VERIFICATION');
    expect(user!.email).toBe('alice@example.com');

    const otp = await prisma.otpCode.findFirst({ where: { userId } });
    expect(otp).not.toBeNull();
    expect(otp!.used).toBe(false);

    const outboxRow = await prisma.outbox.findFirst({ where: { type: 'otp.send' } });
    expect(outboxRow).not.toBeNull();
  });

  it('duplicate identifier → 409 identifier_taken', async () => {
    const payload = { identifier: 'alice@example.com', password: 'Password1' };
    await app.inject({ method: 'POST', url: '/v1/auth/register', payload });

    const res = await app.inject({ method: 'POST', url: '/v1/auth/register', payload });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('identifier_taken');
  });

  it('weak password → 400 validation_failed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { identifier: 'alice@example.com', password: 'weak' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
  });
});
