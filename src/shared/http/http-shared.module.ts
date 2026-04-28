import { Module } from '@nestjs/common';
import { RateLimiter } from './rate-limiter.service';

@Module({
  providers: [RateLimiter],
  exports: [RateLimiter],
})
export class HttpSharedModule {}
