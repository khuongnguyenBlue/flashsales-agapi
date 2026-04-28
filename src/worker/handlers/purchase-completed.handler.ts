import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HandlerRegistry } from '../handler-registry';

interface PurchaseCompletedPayload {
  purchase_id: string;
  user_id: string;
  flash_sale_item_id: string;
}

@Injectable()
export class PurchaseCompletedHandler implements OnModuleInit {
  private readonly logger = new Logger(PurchaseCompletedHandler.name);

  constructor(private readonly registry: HandlerRegistry) {}

  onModuleInit(): void {
    this.registry.register('purchase.completed', this.handle.bind(this));
  }

  async handle(payload: unknown): Promise<void> {
    const { purchase_id, user_id, flash_sale_item_id } = payload as PurchaseCompletedPayload;
    this.logger.log({ purchase_id, user_id, flash_sale_item_id }, 'purchase.completed (mock)');
  }
}
