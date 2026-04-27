import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('healthz')
  liveness() {
    return { status: 'ok' };
  }

  @Get('readyz')
  async readiness() {
    const [pgOk, redisOk] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.redis.client.ping().then((r) => r === 'PONG').catch(() => false),
    ]);

    if (!pgOk || !redisOk) {
      throw new ServiceUnavailableException({
        status: 'degraded',
        checks: { postgres: pgOk ? 'ok' : 'fail', redis: redisOk ? 'ok' : 'fail' },
      });
    }

    return { status: 'ready', checks: { postgres: 'ok', redis: 'ok' } };
  }
}
