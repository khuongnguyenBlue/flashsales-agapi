import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpChannel, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AppHttpException } from '../../shared/http/app-http.exception';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { TransactionService } from '../../shared/transaction/transaction.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { normalizeIdentifier } from './identifier.util';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  private readonly bcryptCost: number;

  constructor(
    private readonly users: UsersService,
    private readonly otp: OtpService,
    private readonly token: TokenService,
    private readonly tx: TransactionService,
    private readonly outbox: OutboxService,
    config: ConfigService,
  ) {
    this.bcryptCost = Number(config.getOrThrow('BCRYPT_COST'));
  }

  async register(dto: RegisterDto): Promise<{ userId: string }> {
    const identifier = normalizeIdentifier(dto.identifier);

    const existing = await this.users.findByIdentifier(identifier);
    if (existing) {
      throw new AppHttpException(
        'identifier_taken',
        'Identifier already registered',
        HttpStatus.CONFLICT,
      );
    }

    const [passwordHash, { plainCode, hashedCode, expiresAt }] = await Promise.all([
      bcrypt.hash(dto.password, this.bcryptCost),
      this.otp.prepare(),
    ]);

    const channel: OtpChannel = identifier.kind === 'EMAIL' ? 'EMAIL' : 'PHONE';

    const userId = await this.tx.run(async (client) => {
      let user;
      try {
        user = await this.users.create(client, {
          ...(identifier.kind === 'EMAIL'
            ? { email: identifier.normalized }
            : { phone: identifier.normalized }),
          passwordHash,
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new AppHttpException('identifier_taken', 'Identifier already registered', HttpStatus.CONFLICT);
        }
        throw err;
      }

      const otpRecord = await this.otp.create(client, user.id, channel, hashedCode, expiresAt);

      await this.outbox.append(client, {
        type: 'otp.send',
        payload: {
          user_id: user.id,
          otp_id: otpRecord.id,
          channel,
          identifier: identifier.normalized,
          plain_code: plainCode,
        },
        idempotencyKey: otpRecord.id,
      });

      return user.id;
    });

    return { userId };
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<{ accessToken: string; refreshToken: string }> {
    const identifier = normalizeIdentifier(dto.identifier);

    const user = await this.users.findByIdentifier(identifier);
    if (!user) {
      throw new AppHttpException('otp_invalid', 'Invalid OTP code', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const otpRecord = await this.otp.findValid(user.id);
    if (!otpRecord) {
      throw new AppHttpException('otp_expired', 'OTP has expired', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const codeMatch = await bcrypt.compare(dto.code, otpRecord.hashedCode);
    if (!codeMatch) {
      await this.otp.incrementAttempts(otpRecord.id);
      throw new AppHttpException('otp_invalid', 'Invalid OTP code', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    await this.tx.run(async (client) => {
      await this.otp.markUsed(client, otpRecord.id);
      await this.users.markActive(client, user.id);
    });

    return this.token.issuePair(user.id);
  }
}
