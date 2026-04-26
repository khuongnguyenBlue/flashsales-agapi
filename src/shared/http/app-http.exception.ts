import { HttpException } from '@nestjs/common';

export class AppHttpException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }
}
