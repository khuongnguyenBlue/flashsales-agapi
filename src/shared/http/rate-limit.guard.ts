import { CanActivate, ExecutionContext, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';
import { AppHttpException } from './app-http.exception';
import { RateLimiter } from './rate-limiter.service';
import { normalizeIdentifier } from '../../modules/auth/identifier.util';

export interface RateLimitConfig {
  prefix: string;
  key: 'ip' | 'identifier' | 'user_id';
  capacity: number;
  refillPerSec: number;
}

export const RATE_LIMIT_KEY = Symbol('RATE_LIMIT');
export const RateLimit = (...configs: RateLimitConfig[]) => SetMetadata(RATE_LIMIT_KEY, configs);

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: RateLimiter,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const configs = this.reflector.get<RateLimitConfig[]>(RATE_LIMIT_KEY, context.getHandler());
    if (!configs?.length) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest>();

    for (const config of configs) {
      const keyValue = this.extractKeyValue(config, req);
      const redisKey = `rl:${config.prefix}:${config.key}:${keyValue}`;
      const result = await this.limiter.allow(redisKey, config.capacity, config.refillPerSec);

      // Tokens are consumed in declaration order. For login (IP + identifier), the IP
      // token is spent even if the identifier bucket subsequently 429s. This is
      // intentional — it makes identifier enumeration harder via IP cycling.
      if (!result.allowed) {
        throw new AppHttpException(
          'rate_limited',
          'Too many requests',
          HttpStatus.TOO_MANY_REQUESTS,
          { retry_after_seconds: result.retryAfterSeconds },
        );
      }
    }

    return true;
  }

  private extractKeyValue(config: RateLimitConfig, req: FastifyRequest): string {
    if (config.key === 'ip') {
      // 'unknown' collapses all unresolvable clients into one bucket — acceptable for
      // MVP but flag if seen in staging logs (likely a misconfigured proxy).
      return req.ip ?? 'unknown';
    }

    if (config.key === 'user_id') {
      // APP_GUARD runs before JwtAuthGuard so req.user is not populated yet.
      // Decode the JWT payload (no signature verification — auth still happens in
      // JwtAuthGuard) to extract the subject for per-user bucketing.
      const auth = req.headers.authorization;
      if (auth?.startsWith('Bearer ')) {
        try {
          const payloadB64 = auth.slice(7).split('.')[1];
          const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
            sub?: string;
          };
          if (payload.sub) return payload.sub;
        } catch {
          // malformed token — fall through to 'unauthenticated'
        }
      }
      // No valid token: collapse into a shared bucket; JwtAuthGuard issues the 401.
      return 'unauthenticated';
    }

    const body = req.body as Record<string, unknown> | undefined;
    const raw = typeof body?.identifier === 'string' ? body.identifier : '';
    try {
      return normalizeIdentifier(raw).normalized;
    } catch {
      return raw;
    }
  }
}
