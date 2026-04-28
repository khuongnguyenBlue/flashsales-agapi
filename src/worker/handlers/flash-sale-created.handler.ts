import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HandlerRegistry } from '../handler-registry';

interface FlashSaleCreatedPayload {
  flash_sale_id: string;
  item_ids: string[];
}

@Injectable()
export class FlashSaleCreatedHandler implements OnModuleInit {
  private readonly logger = new Logger(FlashSaleCreatedHandler.name);

  constructor(private readonly registry: HandlerRegistry) {}

  onModuleInit(): void {
    this.registry.register('flash_sale.created', this.handle.bind(this));
  }

  async handle(payload: unknown): Promise<void> {
    const { flash_sale_id, item_ids } = payload as FlashSaleCreatedPayload;
    this.logger.log({ flash_sale_id, item_ids }, 'flash_sale.created (mock)');
  }
}
