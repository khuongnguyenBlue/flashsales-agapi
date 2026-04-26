import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_PRIVATE_KEY_BASE64: z.string().min(1),
  JWT_PUBLIC_KEY_BASE64: z.string().min(1),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604800),

  BCRYPT_COST: z.coerce.number().int().min(4).max(31).default(12),

  SERVER_TIMEZONE: z.string().min(1).default('Asia/Ho_Chi_Minh'),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(200),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
});

export type Env = z.infer<typeof envSchema>;
