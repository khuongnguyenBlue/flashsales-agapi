import { CanActivate, ExecutionContext, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';
import { AppHttpException } from './app-http.exception';
import { RateLimiter } from './rate-limiter.service';
import { normalizeIdentifier } from '../../modules/auth/identifier.util';

export interface RateLimitConfig {
  prefix: string;
  key: 'ip' | 'identifier';
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
      return req.ip ?? 'unknown';
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
