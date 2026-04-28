import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppConfigModule } from './shared/config/config.module';
import { HealthModule } from './shared/health/health.module';
import { RequestIdMiddleware } from './shared/http/request-id.middleware';
import { AppLoggerModule } from './shared/logger/logger.module';
import { OutboxModule } from './shared/outbox/outbox.module';
import { PrismaModule } from './shared/prisma/prisma.module';
import { RedisModule } from './shared/redis/redis.module';
import { TransactionModule } from './shared/transaction/transaction.module';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    PrismaModule,
    RedisModule,
    TransactionModule,
    OutboxModule,
    HealthModule,
    AuthModule,
  ],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
