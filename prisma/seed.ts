import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const BCRYPT_COST = 4; // low cost for seed speed
const PASSWORD_HASH = bcrypt.hashSync('Test1234!', BCRYPT_COST);
const BALANCE_CENTS = 50_000_000n;

const PRODUCTS = [
  { id: 'a0000000-0000-4000-8000-000000000001', sku: 'iphone-15', name: 'iPhone 15', stock: 1000n, priceCents: 25_000_000n },
  { id: 'a0000000-0000-4000-8000-000000000002', sku: 'airpods-pro', name: 'AirPods Pro', stock: 1000n, priceCents: 6_000_000n },
  { id: 'a0000000-0000-4000-8000-000000000003', sku: 'macbook-air', name: 'MacBook Air M2', stock: 1000n, priceCents: 30_000_000n },
  { id: 'a0000000-0000-4000-8000-000000000004', sku: 'ipad-pro', name: 'iPad Pro 12.9"', stock: 1000n, priceCents: 20_000_000n },
  { id: 'a0000000-0000-4000-8000-000000000005', sku: 'apple-watch', name: 'Apple Watch Series 9', stock: 1000n, priceCents: 10_000_000n },
];

const now = Date.now();

const SALES = [
  {
    id: 'b0000000-0000-4000-8000-000000000001',
    name: 'Historical Sale',
    startsAt: new Date(now - 25 * 3_600_000),
    endsAt: new Date(now - 1 * 3_600_000),
    items: [
      { id: 'c0000000-0000-4000-8000-000000000001', productId: PRODUCTS[0].id, quantity: 100, priceCents: 12_500_000n },
      { id: 'c0000000-0000-4000-8000-000000000002', productId: PRODUCTS[1].id, quantity: 100, priceCents: 3_000_000n },
    ],
  },
  {
    id: 'b0000000-0000-4000-8000-000000000002',
    name: 'Active Sale',
    startsAt: new Date(now - 5 * 60_000),
    endsAt: new Date(now + 3_600_000),
    items: [
      { id: 'c0000000-0000-4000-8000-000000000003', productId: PRODUCTS[2].id, quantity: 100, priceCents: 15_000_000n },
      { id: 'c0000000-0000-4000-8000-000000000004', productId: PRODUCTS[3].id, quantity: 100, priceCents: 10_000_000n },
      { id: 'c0000000-0000-4000-8000-000000000005', productId: PRODUCTS[4].id, quantity: 100, priceCents: 5_000_000n },
    ],
  },
  {
    id: 'b0000000-0000-4000-8000-000000000003',
    name: 'Future Sale',
    startsAt: new Date(now + 3_600_000),
    endsAt: new Date(now + 7_200_000),
    items: [
      { id: 'c0000000-0000-4000-8000-000000000006', productId: PRODUCTS[0].id, quantity: 100, priceCents: 20_000_000n },
      { id: 'c0000000-0000-4000-8000-000000000007', productId: PRODUCTS[1].id, quantity: 100, priceCents: 4_000_000n },
    ],
  },
];

async function seedProducts() {
  for (const p of PRODUCTS) {
    await prisma.product.upsert({
      where: { id: p.id },
      update: {},
      create: p,
    });
  }
  console.log(`Seeded ${PRODUCTS.length} products`);
}

async function seedSales() {
  for (const sale of SALES) {
    const exists = await prisma.flashSale.findUnique({ where: { id: sale.id } });
    if (exists) continue;

    await prisma.$transaction(async (client) => {
      await client.flashSale.create({
        data: { id: sale.id, name: sale.name, startsAt: sale.startsAt, endsAt: sale.endsAt },
      });

      for (const item of sale.items) {
        // Lock and decrement product stock
        await client.$executeRaw`SELECT id FROM products WHERE id = ${item.productId}::uuid FOR UPDATE`;
        await client.$executeRaw`UPDATE products SET stock = stock - ${item.quantity} WHERE id = ${item.productId}::uuid`;
        await client.flashSaleItem.create({
          data: {
            id: item.id,
            flashSaleId: sale.id,
            productId: item.productId,
            quantity: item.quantity,
            priceCents: item.priceCents,
          },
        });
      }

      await client.outbox.create({
        data: {
          type: 'flash_sale.created',
          payload: { flash_sale_id: sale.id, item_ids: sale.items.map((i) => i.id) },
          idempotencyKey: sale.id,
        },
      });
    });
  }
  console.log(`Seeded ${SALES.length} flash sales`);
}

async function seedUsers() {
  let created = 0;
  for (let i = 1; i <= 100; i++) {
    const num = String(i).padStart(3, '0');
    const email = `user${num}@test.local`;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) continue;

    await prisma.user.create({
      data: {
        email,
        passwordHash: PASSWORD_HASH,
        status: 'ACTIVE',
        balanceCents: BALANCE_CENTS,
      },
    });
    created++;
  }
  console.log(`Seeded ${created} new users (100 total)`);
}

async function main() {
  await seedProducts();
  await seedSales();
  await seedUsers();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
