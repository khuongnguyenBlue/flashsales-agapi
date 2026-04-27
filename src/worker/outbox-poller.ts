import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import { HandlerRegistry } from './handler-registry';

interface OutboxRow {
  id: bigint;
  type: string;
  payload: unknown;
  attempts: number;
  idempotency_key: string | null;
}

@Injectable()
export class OutboxPoller implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxPoller.name);
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: HandlerRegistry,
    config: ConfigService,
  ) {
    this.pollIntervalMs = Number(config.getOrThrow('OUTBOX_POLL_INTERVAL_MS'));
    this.batchSize = Number(config.getOrThrow('OUTBOX_BATCH_SIZE'));
    this.maxAttempts = Number(config.getOrThrow('OUTBOX_MAX_ATTEMPTS'));
  }

  onApplicationBootstrap(): void {
    this.start();
  }

  onApplicationShutdown(): void {
    this.stop();
  }

  start(): void {
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedule());
    }, this.pollIntervalMs);
  }

  async tick(): Promise<void> {
    await this.prisma.$transaction(async (client) => {
      const rows = await client.$queryRaw<OutboxRow[]>(Prisma.sql`
        SELECT id, type, payload, attempts, idempotency_key
        FROM outbox
        WHERE status = 'PENDING' AND visible_at <= now()
        ORDER BY id
        LIMIT ${Prisma.raw(String(this.batchSize))}
        FOR UPDATE SKIP LOCKED
      `);

      for (const row of rows) {
        await this.processRow(client, row);
      }
    });
  }

  private async processRow(
    client: Prisma.TransactionClient,
    row: OutboxRow,
  ): Promise<void> {
    const id = BigInt(row.id);
    const attempts = Number(row.attempts);
    const handler = this.registry.get(row.type as Parameters<HandlerRegistry['get']>[0]);

    try {
      if (handler) {
        await handler(row.payload, row.idempotency_key);
      } else {
        this.logger.warn(`No handler for outbox type '${row.type}' (id=${row.id}) — marking PROCESSED`);
      }
      await client.outbox.update({ where: { id }, data: { status: 'PROCESSED' } });
    } catch (err) {
      const nextAttempts = attempts + 1;
      const isDead = nextAttempts >= this.maxAttempts;

      if (isDead) {
        await client.outbox.update({
          where: { id },
          data: { status: 'DEAD_LETTER', attempts: nextAttempts, lastError: String(err) },
        });
      } else {
        const backoffMs =
          Math.min(2 ** nextAttempts * 1000, 5 * 60_000) + Math.floor(Math.random() * 1000);
        await client.outbox.update({
          where: { id },
          data: {
            attempts: nextAttempts,
            lastError: String(err),
            visibleAt: new Date(Date.now() + backoffMs),
          },
        });
      }

      this.logger.warn(
        `Outbox row ${row.id} (${row.type}) attempt ${nextAttempts}/${this.maxAttempts}: ${String(err)}`,
      );
    }
  }
}
