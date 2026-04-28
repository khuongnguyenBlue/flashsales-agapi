import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigModule } from './shared/config/config.module';
import { HealthModule } from './shared/health/health.module';
import { HttpSharedModule } from './shared/http/http-shared.module';
import { RateLimitGuard } from './shared/http/rate-limit.guard';
import { RequestIdMiddleware } from './shared/http/request-id.middleware';
import { AppLoggerModule } from './shared/logger/logger.module';
import { OutboxModule } from './shared/outbox/outbox.module';
import { PrismaModule } from './shared/prisma/prisma.module';
import { RedisModule } from './shared/redis/redis.module';
import { TransactionModule } from './shared/transaction/transaction.module';
import { AuthModule } from './modules/auth/auth.module';
import { FlashSaleModule } from './modules/flashsale/flashsale.module';

@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    PrismaModule,
    RedisModule,
    TransactionModule,
    OutboxModule,
    HttpSharedModule,
    HealthModule,
    AuthModule,
    FlashSaleModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
