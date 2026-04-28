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

    await this.redis.client.set(`refresh:${jti}`, JSON.stringify({ userId, hash }), 'EX', this.refreshTtl);

    return { accessToken, refreshToken };
  }

  async rotate(token: string): Promise<{ accessToken: string; refreshToken: string } | null> {
    const result = await this.parseAndVerify(token);
    if (!result) return null;

    await this.redis.client.del(`refresh:${result.jti}`);
    return this.issuePair(result.userId);
  }

  async revoke(token: string): Promise<void> {
    const result = await this.parseAndVerify(token);
    if (!result) return;
    await this.redis.client.del(`refresh:${result.jti}`);
  }

  private async parseAndVerify(token: string): Promise<{ userId: string; jti: string } | null> {
    const dotIndex = token.indexOf('.');
    if (dotIndex === -1) return null;

    const jti = token.slice(0, dotIndex);
    const rawPart = token.slice(dotIndex + 1);

    const stored = await this.redis.client.get(`refresh:${jti}`);
    if (!stored) return null;

    const { userId, hash } = JSON.parse(stored) as { userId: string; hash: string };
    const candidateBuf = Buffer.from(crypto.createHash('sha256').update(rawPart).digest('hex'), 'hex');
    const storedBuf = Buffer.from(hash, 'hex');

    if (candidateBuf.length !== storedBuf.length) return null;
    return crypto.timingSafeEqual(candidateBuf, storedBuf) ? { userId, jti } : null;
  }
}
