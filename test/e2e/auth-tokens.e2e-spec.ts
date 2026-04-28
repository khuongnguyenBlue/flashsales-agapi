import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as bcrypt from 'bcrypt';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { AppErrorFilter } from '../../src/shared/http/error.filter';
import { PrismaModule } from '../../src/shared/prisma/prisma.module';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { RedisModule } from '../../src/shared/redis/redis.module';
import { startInfra, type InfraHandles } from '../helpers/testcontainers';

const BCRYPT_COST = 4;

describe('Auth token lifecycle (e2e)', () => {
  let infra: InfraHandles;
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    infra = await startInfra();
    process.env.DATABASE_URL = infra.databaseUrl;
    process.env.REDIS_URL = infra.redisUrl;
    process.env.BCRYPT_COST = String(BCRYPT_COST);
    process.env.OTP_TTL_SECONDS = '300';
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
    await prisma.user.deleteMany();
  });

  async function loginActiveUser(email: string): Promise<{ accessToken: string; refreshToken: string }> {
    await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash('Password1', BCRYPT_COST),
        status: 'ACTIVE',
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { identifier: email, password: 'Password1' },
    });
    return res.json<{ accessToken: string; refreshToken: string }>();
  }

  it('refresh rotates tokens — old refresh rejected on replay', async () => {
    const { refreshToken: oldRefresh } = await loginActiveUser('alice@example.com');

    const refreshRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: oldRefresh },
    });
    expect(refreshRes.statusCode).toBe(200);
    const { accessToken, refreshToken: newRefresh } = refreshRes.json<{ accessToken: string; refreshToken: string }>();
    expect(typeof accessToken).toBe('string');
    expect(newRefresh).not.toBe(oldRefresh);

    const replayRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: oldRefresh },
    });
    expect(replayRes.statusCode).toBe(401);
    expect(replayRes.json().error.code).toBe('invalid_token');
  });

  it('logout invalidates the refresh token', async () => {
    const { accessToken, refreshToken } = await loginActiveUser('bob@example.com');

    const logoutRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { refreshToken },
    });
    expect(logoutRes.statusCode).toBe(204);

    const refreshRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(refreshRes.statusCode).toBe(401);
  });

  it('resend-otp returns 204 for PENDING user', async () => {
    await prisma.user.create({
      data: {
        email: 'charlie@example.com',
        passwordHash: await bcrypt.hash('Password1', BCRYPT_COST),
        status: 'PENDING_VERIFICATION',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/resend-otp',
      payload: { identifier: 'charlie@example.com' },
    });
    expect(res.statusCode).toBe(204);

    const otpCount = await prisma.otpCode.count({ where: { user: { email: 'charlie@example.com' } } });
    expect(otpCount).toBe(1);
  });

  it('resend-otp is a no-op for unknown identifier → 204', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/resend-otp',
      payload: { identifier: 'ghost@example.com' },
    });
    expect(res.statusCode).toBe(204);
  });
});
