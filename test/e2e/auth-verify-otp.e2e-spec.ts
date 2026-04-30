import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { OtpCryptoService } from '../../src/shared/crypto/otp-crypto.service';
import { AppErrorFilter } from '../../src/shared/http/error.filter';
import { PrismaModule } from '../../src/shared/prisma/prisma.module';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { RedisModule } from '../../src/shared/redis/redis.module';
import { startInfra, type InfraHandles } from '../helpers/testcontainers';

describe('POST /v1/auth/verify-otp (e2e)', () => {
  let infra: InfraHandles;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let crypto: OtpCryptoService;

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
    crypto = module.get(OtpCryptoService);
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await app.close();
    await infra.shutdown();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  it('valid code → 200 + token pair + user status=ACTIVE', async () => {
    const plainCode = '123456';
    const user = await prisma.user.create({
      data: { email: 'bob@example.com', passwordHash: 'hashed' },
    });
    await prisma.otpCode.create({
      data: {
        userId: user.id,
        channel: 'EMAIL',
        encryptedCode: crypto.encrypt(plainCode),
        expiresAt: new Date(Date.now() + 300_000),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify-otp',
      payload: { identifier: 'bob@example.com', code: plainCode },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ accessToken: string; refreshToken: string }>();
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
    expect(body.refreshToken).toContain('.');

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updated!.status).toBe('ACTIVE');

    const otp = await prisma.otpCode.findFirst({ where: { userId: user.id } });
    expect(otp!.used).toBe(true);
  });

  it('wrong code → 422 otp_invalid', async () => {
    const user = await prisma.user.create({
      data: { email: 'charlie@example.com', passwordHash: 'hashed' },
    });
    await prisma.otpCode.create({
      data: {
        userId: user.id,
        channel: 'EMAIL',
        encryptedCode: crypto.encrypt('123456'),
        expiresAt: new Date(Date.now() + 300_000),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify-otp',
      payload: { identifier: 'charlie@example.com', code: '999999' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('otp_invalid');
  });

  it('expired OTP → 422 otp_expired', async () => {
    const user = await prisma.user.create({
      data: { email: 'dave@example.com', passwordHash: 'hashed' },
    });
    await prisma.otpCode.create({
      data: {
        userId: user.id,
        channel: 'EMAIL',
        encryptedCode: crypto.encrypt('123456'),
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify-otp',
      payload: { identifier: 'dave@example.com', code: '123456' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('otp_expired');
  });
});
