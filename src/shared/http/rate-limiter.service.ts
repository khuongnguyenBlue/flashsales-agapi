import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

const LUA_TOKEN_BUCKET = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_per_sec = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  ts = now_ms
end

local elapsed_sec = math.max(0, (now_ms - ts) / 1000)
tokens = math.min(capacity, tokens + elapsed_sec * refill_per_sec)

if tokens < 1 then
  local retry_after = math.ceil((1 - tokens) / refill_per_sec)
  return {0, retry_after}
end

tokens = tokens - 1
local ttl_sec = math.ceil(capacity / refill_per_sec) + 1
redis.call('HMSET', key, 'tokens', tostring(tokens), 'ts', tostring(now_ms))
redis.call('EXPIRE', key, ttl_sec)
return {1, 0}
`;

export interface AllowResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

@Injectable()
export class RateLimiter {
  constructor(private readonly redis: RedisService) {}

  async allow(key: string, capacity: number, refillPerSec: number): Promise<AllowResult> {
    const result = (await this.redis.client.eval(
      LUA_TOKEN_BUCKET,
      1,
      key,
      String(capacity),
      String(refillPerSec),
      String(Date.now()),
    )) as [number, number];

    return { allowed: result[0] === 1, retryAfterSeconds: result[1] };
  }
}
