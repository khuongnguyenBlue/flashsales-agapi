import { Global, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

@Global()
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        // Mirror the request ID set by RequestIdMiddleware so log lines correlate with the response header.
        genReqId: (req) => req.headers['x-request-id'] as string,
        redact: [
          'req.headers.authorization',
          'req.body.password',
          'req.body.code',
          'req.body.refresh_token',
        ],
        autoLogging: true,
        quietReqLogger: true,
      },
    }),
  ],
})
export class AppLoggerModule {}
