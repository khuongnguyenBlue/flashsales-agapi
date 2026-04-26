import { envSchema } from './env.schema';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_PRIVATE_KEY_BASE64: 'c2VjcmV0LXRoYXQtaXMtbG9uZy1lbm91Z2gtZm9yLWhzMjU2',
  JWT_PUBLIC_KEY_BASE64: 'c2VjcmV0LXRoYXQtaXMtbG9uZy1lbm91Z2gtZm9yLWhzMjU2',
  JWT_ACCESS_TTL_SECONDS: '900',
  JWT_REFRESH_TTL_SECONDS: '604800',
  BCRYPT_COST: '12',
  SERVER_TIMEZONE: 'Asia/Ho_Chi_Minh',
  OTP_TTL_SECONDS: '300',
  OUTBOX_POLL_INTERVAL_MS: '200',
  OUTBOX_BATCH_SIZE: '50',
  OUTBOX_MAX_ATTEMPTS: '10',
};

describe('envSchema', () => {
  it('parses valid env with coerced numeric types', () => {
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.PORT).toBe(3000);
    expect(result.data.BCRYPT_COST).toBe(12);
    expect(result.data.JWT_ACCESS_TTL_SECONDS).toBe(900);
  });

  it('throws when PORT is not a number', () => {
    const result = envSchema.safeParse({ ...validEnv, PORT: 'not-a-number' });
    expect(result.success).toBe(false);
    if (result.success) return;

    const paths = result.error.issues.map((i) => i.path[0]);
    expect(paths).toContain('PORT');
  });
});
