import { Injectable } from '@nestjs/common';
import { OutboxEventType } from '../shared/outbox/outbox.types';

export type OutboxHandler = (payload: unknown, idempotencyKey: string | null) => Promise<void>;

@Injectable()
export class HandlerRegistry {
  private readonly handlers = new Map<OutboxEventType, OutboxHandler>();

  register(type: OutboxEventType, handler: OutboxHandler): void {
    this.handlers.set(type, handler);
  }

  get(type: OutboxEventType): OutboxHandler | undefined {
    return this.handlers.get(type);
  }
}
