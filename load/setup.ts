/**
 * Pre-load setup: authenticates 100 seeded test users, writes load/tokens.json,
 * and prints the active flash sale item ID to use as SALE_ITEM_ID.
 *
 * Run after `npm run prisma:seed` and while `docker compose up` is running.
 * Usage: npx tsx load/setup.ts [BASE_URL]
 */
import { writeFileSync } from 'fs';
import { join } from 'path';

const BASE_URL = process.argv[2] ?? 'http://localhost:3000';

async function login(identifier: string, password: string): Promise<string | null> {
  const res = await fetch(`${BASE_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) {
    console.warn(`Login failed for ${identifier}: ${res.status}`);
    return null;
  }
  const body = (await res.json()) as { accessToken: string };
  return body.accessToken;
}

async function getActiveSaleItemId(): Promise<string | null> {
  const res = await fetch(`${BASE_URL}/v1/flashsale/active`);
  if (!res.ok) return null;
  const body = (await res.json()) as { items: Array<{ id: string }> };
  return body.items[0]?.id ?? null;
}

async function main() {
  console.log(`Connecting to ${BASE_URL}…`);

  const saleItemId = await getActiveSaleItemId();
  if (!saleItemId) {
    console.error('No active flash sale items found. Run: npm run prisma:seed');
    process.exit(1);
  }

  console.log(`Active sale item: ${saleItemId}`);

  const tokens: string[] = [];
  for (let i = 1; i <= 100; i++) {
    const email = `user${String(i).padStart(3, '0')}@test.local`;
    const token = await login(email, 'Test1234!');
    if (token) tokens.push(token);
    if (i % 10 === 0) process.stdout.write(`  ${i}/100 users authenticated\n`);
  }

  const outPath = join(__dirname, 'tokens.json');
  writeFileSync(outPath, JSON.stringify(tokens, null, 2));
  console.log(`\nWrote ${tokens.length} tokens → ${outPath}`);
  console.log(`\nRun the load test with:`);
  console.log(`  SALE_ITEM_ID=${saleItemId} k6 run load/purchase.js`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
