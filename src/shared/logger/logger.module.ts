import { Global, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

@Global()
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
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
