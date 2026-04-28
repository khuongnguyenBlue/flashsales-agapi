import { Module } from '@nestjs/common';
import { AppConfigModule } from './shared/config/config.module';
import { AppLoggerModule } from './shared/logger/logger.module';
import { PrismaModule } from './shared/prisma/prisma.module';
import { HandlerRegistry } from './worker/handler-registry';
import { OutboxPoller } from './worker/outbox-poller';
import { OtpSendHandler } from './worker/handlers/otp-send.handler';
import { FlashSaleCreatedHandler } from './worker/handlers/flash-sale-created.handler';
import { PurchaseCompletedHandler } from './worker/handlers/purchase-completed.handler';

@Module({
  imports: [AppConfigModule, AppLoggerModule, PrismaModule],
  providers: [HandlerRegistry, OutboxPoller, OtpSendHandler, FlashSaleCreatedHandler, PurchaseCompletedHandler],
})
export class WorkerModule {}
