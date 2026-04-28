import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { OutboxModule } from '../../shared/outbox/outbox.module';
import { TransactionModule } from '../../shared/transaction/transaction.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

@Module({
  imports: [
    UsersModule,
    TransactionModule,
    OutboxModule,
    PassportModule,
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        secret: Buffer.from(config.getOrThrow<string>('JWT_PRIVATE_KEY_BASE64'), 'base64').toString(),
        signOptions: {
          expiresIn: Number(config.getOrThrow('JWT_ACCESS_TTL_SECONDS')),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, OtpService, TokenService, JwtStrategy],
})
export class AuthModule {}
