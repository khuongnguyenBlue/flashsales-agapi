import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { HandlerRegistry } from '../handler-registry';

interface FlashSaleSettlePayload {
  flash_sale_id: string;
}

@Injectable()
export class FlashSaleSettleHandler implements OnModuleInit {
  private readonly logger = new Logger(FlashSaleSettleHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: HandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register('flash_sale.settle', this.handle.bind(this));
  }

  async handle(payload: unknown): Promise<void> {
    const { flash_sale_id } = payload as FlashSaleSettlePayload;
    await this.settle(flash_sale_id);
  }

  private async settle(saleId: string): Promise<void> {
    await this.prisma.$transaction(async (client) => {
      // Re-fetch with FOR UPDATE so concurrent workers don't double-settle.
      const rows = await client.$queryRaw<Array<{ settled_at: Date | null }>>(Prisma.sql`
        SELECT settled_at FROM flash_sales WHERE id = ${saleId}::uuid FOR UPDATE
      `);

      if (!rows[0] || rows[0].settled_at !== null) return;

      const items = await client.$queryRaw<Array<{ product_id: string; unsold: number }>>(Prisma.sql`
        SELECT product_id, (quantity - sold) AS unsold
        FROM flash_sale_items
        WHERE flash_sale_id = ${saleId}::uuid AND quantity > sold
      `);

      for (const item of items) {
        await client.$executeRaw(Prisma.sql`
          UPDATE products SET stock = stock + ${item.unsold} WHERE id = ${item.product_id}::uuid
        `);
      }

      await client.$executeRaw(Prisma.sql`
        UPDATE flash_sales SET settled_at = now() WHERE id = ${saleId}::uuid
      `);

      const totalReturned = items.reduce((sum, i) => sum + Number(i.unsold), 0);
      this.logger.log(
        `Settled flash_sale ${saleId}: returned ${totalReturned} units across ${items.length} item(s)`,
      );
    });
  }
}
