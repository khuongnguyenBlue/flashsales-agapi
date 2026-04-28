import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Observable, of, tap } from 'rxjs';
import { AppHttpException } from './app-http.exception';
import { RedisService } from '../redis/redis.service';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TTL_SECONDS = 86_400; // 24 hours

interface CachedResponse {
  status: number;
  body: unknown;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly redis: RedisService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    if (!idempotencyKey || !UUID_RE.test(idempotencyKey)) {
      throw new AppHttpException(
        'idempotency_key_required',
        'Idempotency-Key header is required and must be a UUID.',
        400,
      ); // (code, message, status)
    }

    const redisKey = `idem:${idempotencyKey}`;
    const cached = await this.redis.client.get(redisKey);

    if (cached) {
      const { status, body } = JSON.parse(cached) as CachedResponse;
      const reply = context.switchToHttp().getResponse<FastifyReply>();
      reply.status(status);
      return of(body);
    }

    return next.handle().pipe(
      tap({
        next: (body: unknown) => {
          const reply = context.switchToHttp().getResponse<FastifyReply>();
          const entry: CachedResponse = { status: reply.statusCode, body };
          void this.redis.client.set(redisKey, JSON.stringify(entry), 'EX', TTL_SECONDS);
        },
      }),
    );
  }
}
