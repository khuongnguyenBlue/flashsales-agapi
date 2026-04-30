import { Prisma } from '@prisma/client';

export type OutboxEventType = 'otp.send' | 'purchase.completed' | 'flash_sale.created' | 'flash_sale.settle';

export interface AppendOutboxInput {
  type: OutboxEventType;
  payload: Prisma.InputJsonValue;
  idempotencyKey?: string;
  visibleAt?: Date;
}
