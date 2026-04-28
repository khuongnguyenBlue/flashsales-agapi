import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

export interface ActiveSaleItemDto {
  id: string;
  product: { id: string; sku: string; name: string; description: string | null };
  price_cents: string;
  quantity: number;
  sold: number;
  remaining: number;
  window: { id: string; name: string; starts_at: Date; ends_at: Date };
}

@Injectable()
export class FlashSaleService {
  constructor(private readonly prisma: PrismaService) {}

  async listActive(at: Date): Promise<ActiveSaleItemDto[]> {
    const items = await this.prisma.flashSaleItem.findMany({
      where: {
        flashSale: {
          startsAt: { lte: at },
          endsAt: { gte: at },
        },
      },
      include: {
        product: true,
        flashSale: true,
      },
    });

    return items.map((item) => ({
      id: item.id,
      product: {
        id: item.product.id,
        sku: item.product.sku,
        name: item.product.name,
        description: item.product.description,
      },
      price_cents: item.priceCents.toString(),
      quantity: item.quantity,
      sold: item.sold,
      remaining: item.quantity - item.sold,
      window: {
        id: item.flashSale.id,
        name: item.flashSale.name,
        starts_at: item.flashSale.startsAt,
        ends_at: item.flashSale.endsAt,
      },
    }));
  }
}
