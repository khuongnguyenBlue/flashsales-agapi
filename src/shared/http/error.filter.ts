import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AppHttpException } from './app-http.exception';

const STATUS_CODE_MAP: Record<number, string> = {
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'unprocessable_entity',
  429: 'rate_limited',
};

@Catch()
export class AppErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<FastifyRequest>();
    const res = ctx.getResponse<FastifyReply>();
    const requestId = req.headers['x-request-id'] as string | undefined;

    if (exception instanceof AppHttpException) {
      res.status(exception.getStatus()).send({
        error: {
          code: exception.code,
          message: (exception.getResponse() as { message: string }).message,
          ...(exception.details ? { details: exception.details } : {}),
        },
        request_id: requestId,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      // NestJS ValidationPipe sends { message: string[] }
      if (
        status === HttpStatus.BAD_REQUEST &&
        typeof body === 'object' &&
        body !== null &&
        Array.isArray((body as { message: unknown }).message)
      ) {
        res.status(status).send({
          error: {
            code: 'validation_failed',
            message: 'Validation failed',
            details: { issues: (body as { message: string[] }).message },
          },
          request_id: requestId,
        });
        return;
      }

      const code = STATUS_CODE_MAP[status] ?? 'http_error';
      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string }).message ?? exception.message);

      res.status(status).send({
        error: { code, message },
        request_id: requestId,
      });
      return;
    }

    this.logger.error(exception);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      error: { code: 'internal_error', message: 'Internal server error' },
      request_id: requestId,
    });
  }
}
