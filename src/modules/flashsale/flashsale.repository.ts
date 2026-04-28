import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppHttpException } from '../../shared/http/app-http.exception';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { TransactionService } from '../../shared/transaction/transaction.service';

export interface PurchaseResult {
  purchaseId: string;
  saleItemId: string;
  priceCents: bigint;
  remainingStock: number;
}

@Injectable()
export class FlashSaleRepository {
  constructor(
    private readonly tx: TransactionService,
    private readonly outbox: OutboxService,
    private readonly cfg: ConfigService,
  ) {}

  async purchaseTx(
    userId: string,
    saleItemId: string,
    idempotencyKey: string,
  ): Promise<PurchaseResult> {
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.cfg.getOrThrow<string>('SERVER_TIMEZONE'),
    }).format(new Date());

    return this.tx.run(async (client) => {
      const dup = await client.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS(
          SELECT 1 FROM purchases WHERE user_id = ${userId}::uuid AND day = ${day}::date
        ) AS exists
      `;
      if (dup[0]?.exists) {
        throw new AppHttpException('already_purchased_today', 'Already purchased today.', 409, { day });
      }

      const items = await client.$queryRaw<
        Array<{
          id: string;
          quantity: number;
          sold: number;
          price_cents: bigint;
          starts_at: Date;
          ends_at: Date;
        }>
      >`
        SELECT fsi.id, fsi.quantity, fsi.sold, fsi.price_cents, fs.starts_at, fs.ends_at
        FROM flash_sale_items fsi
        JOIN flash_sales fs ON fs.id = fsi.flash_sale_id
        WHERE fsi.id = ${saleItemId}::uuid
        FOR UPDATE OF fsi
      `;
      const item = items[0];
      if (!item) {
        throw new AppHttpException('sale_item_not_found', 'Sale item not found.', 404);
      }

      const now = new Date();
      if (now < item.starts_at || now > item.ends_at) {
        throw new AppHttpException('out_of_window', 'Flash sale not active.', 409);
      }
      if (item.sold >= item.quantity) {
        throw new AppHttpException('sold_out', 'Sale item sold out.', 409);
      }

      const users = await client.$queryRaw<Array<{ balance_cents: bigint }>>`
        SELECT balance_cents FROM users WHERE id = ${userId}::uuid FOR UPDATE
      `;
      if (!users[0] || users[0].balance_cents < item.price_cents) {
        throw new AppHttpException('insufficient_balance', 'Insufficient balance.', 402);
      }

      await client.$executeRaw`UPDATE flash_sale_items SET sold = sold + 1 WHERE id = ${saleItemId}::uuid`;
      await client.$executeRaw`UPDATE users SET balance_cents = balance_cents - ${item.price_cents} WHERE id = ${userId}::uuid`;

      const purchase = await client.purchase.create({
        data: {
          userId,
          flashSaleItemId: saleItemId,
          day: new Date(day),
          priceCents: item.price_cents,
          idempotencyKey,
        },
      });

      await this.outbox.append(client, {
        type: 'purchase.completed',
        payload: { purchase_id: purchase.id, user_id: userId, flash_sale_item_id: saleItemId },
        idempotencyKey,
      });

      return {
        purchaseId: purchase.id,
        saleItemId,
        priceCents: item.price_cents,
        remainingStock: item.quantity - (item.sold + 1),
      };
    });
  }
}
