import { Module } from '@nestjs/common';
import { AppConfigModule } from './shared/config/config.module';
import { AppLoggerModule } from './shared/logger/logger.module';
import { CryptoModule } from './shared/crypto/crypto.module';
import { PrismaModule } from './shared/prisma/prisma.module';
import { TransactionModule } from './shared/transaction/transaction.module';
import { HandlerRegistry } from './worker/handler-registry';
import { OutboxPoller } from './worker/outbox-poller';
import { OtpSendHandler } from './worker/handlers/otp-send.handler';
import { FlashSaleCreatedHandler } from './worker/handlers/flash-sale-created.handler';
import { FlashSaleSettleHandler } from './worker/handlers/flash-sale-settle.handler';
import { PurchaseCompletedHandler } from './worker/handlers/purchase-completed.handler';

@Module({
  imports: [AppConfigModule, AppLoggerModule, PrismaModule, CryptoModule, TransactionModule],
  providers: [HandlerRegistry, OutboxPoller, OtpSendHandler, FlashSaleCreatedHandler, FlashSaleSettleHandler, PurchaseCompletedHandler],
})
export class WorkerModule {}
