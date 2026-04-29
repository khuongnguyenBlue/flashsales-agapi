import { CanActivate, ExecutionContext, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';
import { Env } from '../config/env.schema';
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
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.config.get('RATE_LIMIT_DISABLED', { infer: true })) return true;

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
      const user = (req as FastifyRequest & { user?: { id: string } }).user;
      return user?.id ?? 'unauthenticated';
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
