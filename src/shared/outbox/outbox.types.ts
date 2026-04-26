import { Prisma } from '@prisma/client';

export type OutboxEventType = 'otp.send' | 'purchase.completed' | 'flash_sale.created';

export interface AppendOutboxInput {
  type: OutboxEventType;
  payload: Prisma.InputJsonValue;
  idempotencyKey?: string;
}
