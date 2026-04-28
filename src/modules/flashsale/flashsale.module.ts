import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { RedisModule } from '../../shared/redis/redis.module';
import { TransactionModule } from '../../shared/transaction/transaction.module';
import { OutboxModule } from '../../shared/outbox/outbox.module';
import { FlashSaleController } from './flashsale.controller';
import { FlashSaleService } from './flashsale.service';
import { FlashSaleRepository } from './flashsale.repository';
import { SaleCreationService } from './sale-creation.service';

@Module({
  imports: [PrismaModule, RedisModule, TransactionModule, OutboxModule],
  controllers: [FlashSaleController],
  providers: [FlashSaleService, FlashSaleRepository, SaleCreationService],
  exports: [SaleCreationService],
})
export class FlashSaleModule {}
