import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { RedisService } from '../../shared/redis/redis.service';

@Injectable()
export class TokenService {
  private readonly refreshTtl: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.refreshTtl = Number(config.getOrThrow('JWT_REFRESH_TTL_SECONDS'));
  }

  async issuePair(userId: string): Promise<{ accessToken: string; refreshToken: string }> {
    const jti = crypto.randomUUID();
    const accessToken = this.jwt.sign({ sub: userId, jti });

    const rawPart = crypto.randomBytes(32).toString('base64url');
    const refreshToken = `${jti}.${rawPart}`;
    const hash = crypto.createHash('sha256').update(rawPart).digest('hex');

    await this.redis.client.set(`refresh:${jti}`, hash, 'EX', this.refreshTtl);

    return { accessToken, refreshToken };
  }
}
