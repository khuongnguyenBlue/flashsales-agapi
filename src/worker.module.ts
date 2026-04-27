import { Module } from '@nestjs/common';
import { AppConfigModule } from './shared/config/config.module';
import { AppLoggerModule } from './shared/logger/logger.module';
import { PrismaModule } from './shared/prisma/prisma.module';
import { HandlerRegistry } from './worker/handler-registry';
import { OutboxPoller } from './worker/outbox-poller';

@Module({
  imports: [AppConfigModule, AppLoggerModule, PrismaModule],
  providers: [HandlerRegistry, OutboxPoller],
})
export class WorkerModule {}
