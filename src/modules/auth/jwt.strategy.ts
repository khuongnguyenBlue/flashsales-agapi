import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  id: string;
  jti: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: Buffer.from(config.getOrThrow<string>('JWT_PUBLIC_KEY_BASE64'), 'base64').toString(),
    });
  }

  validate(payload: { sub: string; jti: string }): JwtPayload {
    return { id: payload.sub, jti: payload.jti };
  }
}
