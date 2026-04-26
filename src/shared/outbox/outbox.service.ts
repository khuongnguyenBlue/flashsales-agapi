import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppendOutboxInput } from './outbox.types';

@Injectable()
export class OutboxService {
  append(client: Prisma.TransactionClient, input: AppendOutboxInput): Promise<void> {
    return client.outbox
      .create({
        data: {
          type: input.type,
          payload: input.payload,
          ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        },
      })
      .then(() => undefined);
  }
}
