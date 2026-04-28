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

describe('POST /v1/auth/login (e2e)', () => {
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

  it('valid credentials → 200 + token pair', async () => {
    await prisma.user.create({
      data: {
        email: 'alice@example.com',
        passwordHash: await bcrypt.hash('Password1', BCRYPT_COST),
        status: 'ACTIVE',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { identifier: 'alice@example.com', password: 'Password1' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ accessToken: string; refreshToken: string }>();
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
  });

  it('wrong password → 401 invalid_credentials', async () => {
    await prisma.user.create({
      data: {
        email: 'alice@example.com',
        passwordHash: await bcrypt.hash('Password1', BCRYPT_COST),
        status: 'ACTIVE',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { identifier: 'alice@example.com', password: 'WrongPass1' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('invalid_credentials');
  });

  it('unknown identifier → 401 invalid_credentials (same shape)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { identifier: 'ghost@example.com', password: 'Password1' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('invalid_credentials');
  });

  it('PENDING user with correct password → 422 account_not_verified', async () => {
    await prisma.user.create({
      data: {
        email: 'pending@example.com',
        passwordHash: await bcrypt.hash('Password1', BCRYPT_COST),
        status: 'PENDING_VERIFICATION',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { identifier: 'pending@example.com', password: 'Password1' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('account_not_verified');
  });
});
