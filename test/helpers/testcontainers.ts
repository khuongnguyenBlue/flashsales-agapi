import { execSync } from 'child_process';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

export interface InfraHandles {
  databaseUrl: string;
  redisUrl: string;
  shutdown(): Promise<void>;
}

export async function startInfra(): Promise<InfraHandles> {
  const [pg, redis] = await Promise.all([
    new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_USER: 'test',
        POSTGRES_PASSWORD: 'test',
        POSTGRES_DB: 'flashsale_test',
      })
      .withExposedPorts(5432)
      .withWaitStrategy(
        Wait.forLogMessage(/database system is ready to accept connections/, 2),
      )
      .start(),
    new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
  ]);

  const databaseUrl = buildPgUrl(pg);
  const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });

  return {
    databaseUrl,
    redisUrl,
    async shutdown() {
      await Promise.all([pg.stop(), redis.stop()]);
    },
  };
}

function buildPgUrl(container: StartedTestContainer): string {
  const host = container.getHost();
  const port = container.getMappedPort(5432);
  return `postgresql://test:test@${host}:${port}/flashsale_test?schema=public`;
}
