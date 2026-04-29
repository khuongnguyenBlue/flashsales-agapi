import { Injectable } from '@nestjs/common';
import { FlashSale, FlashSaleItem } from '@prisma/client';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { TransactionService } from '../../shared/transaction/transaction.service';

export interface SaleItemInput {
  productId: string;
  quantity: number;
  priceCents: bigint;
}

export interface CreateSaleInput {
  name: string;
  startsAt: Date;
  endsAt: Date;
  items: SaleItemInput[];
}

@Injectable()
export class SaleCreationService {
  constructor(
    private readonly tx: TransactionService,
    private readonly outbox: OutboxService,
  ) {}

  async create(input: CreateSaleInput): Promise<{ sale: FlashSale; items: FlashSaleItem[] }> {
    return this.tx.run(async (client) => {
      const sale = await client.flashSale.create({
        data: { name: input.name, startsAt: input.startsAt, endsAt: input.endsAt },
      });

      const items: FlashSaleItem[] = [];
      for (const item of input.items) {
        await client.$executeRaw`SELECT id FROM products WHERE id = ${item.productId}::uuid FOR UPDATE`;
        await client.$executeRaw`UPDATE products SET stock = stock - ${item.quantity} WHERE id = ${item.productId}::uuid`;
        items.push(
          await client.flashSaleItem.create({
            data: {
              flashSaleId: sale.id,
              productId: item.productId,
              quantity: item.quantity,
              priceCents: item.priceCents,
            },
          }),
        );
      }

      await this.outbox.append(client, {
        type: 'flash_sale.created',
        payload: { flash_sale_id: sale.id, item_ids: items.map((i) => i.id) },
        idempotencyKey: sale.id,
      });

      await this.outbox.append(client, {
        type: 'flash_sale.settle',
        payload: { flash_sale_id: sale.id },
        visibleAt: sale.endsAt,
      });

      return { sale, items };
    });
  }
}
