import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { RedisModule } from '../../src/shared/redis/redis.module';
import { RedisService } from '../../src/shared/redis/redis.service';
import { startInfra, type InfraHandles } from '../helpers/testcontainers';

describe('RedisService (e2e)', () => {
  let infra: InfraHandles;
  let service: RedisService;

  beforeAll(async () => {
    infra = await startInfra();
    process.env.REDIS_URL = infra.redisUrl;

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        RedisModule,
      ],
    }).compile();

    service = module.get(RedisService);
  });

  afterAll(async () => {
    await service.onModuleDestroy();
    await infra.shutdown();
  });

  it('set/get round-trips a key with TTL', async () => {
    await service.client.set('smoke:key', 'hello', 'EX', 10);
    const value = await service.client.get('smoke:key');
    expect(value).toBe('hello');

    const ttl = await service.client.ttl('smoke:key');
    expect(ttl).toBeGreaterThan(0);
  });
});
