import { Client } from 'pg';
import { startInfra, type InfraHandles } from '../helpers/testcontainers';

describe('smoke: migrated schema', () => {
  let infra: InfraHandles;
  let client: Client;

  beforeAll(async () => {
    infra = await startInfra();
    client = new Client({ connectionString: infra.databaseUrl });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
    await infra.shutdown();
  });

  it.each(['users', 'otp_codes', 'outbox'])(
    'table "%s" exists after migration',
    async (table) => {
      const result = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = $1
         ) AS exists`,
        [table],
      );
      expect(result.rows[0].exists).toBe(true);
    },
  );
});
