import { Controller, HttpCode, HttpStatus, Module, Post } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppErrorFilter } from '../../src/shared/http/error.filter';
import { HttpSharedModule } from '../../src/shared/http/http-shared.module';
import { RateLimit, RateLimitGuard } from '../../src/shared/http/rate-limit.guard';
import { RedisModule } from '../../src/shared/redis/redis.module';
import { startInfra, type InfraHandles } from '../helpers/testcontainers';

// Minimal controller with a tight rate limit for testing
@Controller('test')
class TestController {
  @Post('limited')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ prefix: 'test', key: 'ip', capacity: 2, refillPerSec: 0.001 })
  limited(): { ok: boolean } {
    return { ok: true };
  }
}

@Module({
  controllers: [TestController],
})
class TestAppModule {}

describe('RateLimitGuard (e2e)', () => {
  let infra: InfraHandles;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    infra = await startInfra();
    process.env.REDIS_URL = infra.redisUrl;

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        RedisModule,
        HttpSharedModule,
        TestAppModule,
      ],
      providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
    }).compile();

    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalFilters(new AppErrorFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    await infra.shutdown();
  });

  it('allows requests within capacity then 429 on overflow', async () => {
    // capacity=2: first two succeed
    const r1 = await app.inject({ method: 'POST', url: '/test/limited' });
    const r2 = await app.inject({ method: 'POST', url: '/test/limited' });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);

    // third request exceeds capacity
    const r3 = await app.inject({ method: 'POST', url: '/test/limited' });
    expect(r3.statusCode).toBe(429);
    expect(r3.json().error.code).toBe('rate_limited');
    expect(typeof r3.json().error.details.retry_after_seconds).toBe('number');
  });
});
