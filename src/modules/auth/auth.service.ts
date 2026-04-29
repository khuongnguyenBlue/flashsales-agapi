import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpChannel, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { OtpCryptoService } from '../../shared/crypto/otp-crypto.service';
import { AppHttpException } from '../../shared/http/app-http.exception';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { TransactionService } from '../../shared/transaction/transaction.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { normalizeIdentifier } from './identifier.util';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly bcryptCost: number;
  private dummyHash!: string;

  constructor(
    private readonly users: UsersService,
    private readonly otp: OtpService,
    private readonly token: TokenService,
    private readonly tx: TransactionService,
    private readonly outbox: OutboxService,
    private readonly crypto: OtpCryptoService,
    config: ConfigService,
  ) {
    this.bcryptCost = Number(config.getOrThrow('BCRYPT_COST'));
  }

  async onModuleInit(): Promise<void> {
    this.dummyHash = await bcrypt.hash('__dummy__', this.bcryptCost);
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
          plain_code: this.crypto.encrypt(plainCode),
        },
        idempotencyKey: otpRecord.id,
      });

      return user.id;
    });

    return { userId };
  }

  async login(dto: LoginDto): Promise<{ accessToken: string; refreshToken: string }> {
    const identifier = normalizeIdentifier(dto.identifier);
    const user = await this.users.findByIdentifier(identifier);

    // Always run bcrypt even when user not found — prevents timing-based enumeration
    const passwordMatch = await bcrypt.compare(dto.password, user?.passwordHash ?? this.dummyHash);

    if (!passwordMatch || !user) {
      throw new AppHttpException('invalid_credentials', 'Invalid credentials', HttpStatus.UNAUTHORIZED);
    }

    if (user.status === 'PENDING_VERIFICATION') {
      throw new AppHttpException('account_not_verified', 'Account not verified', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    return this.token.issuePair(user.id);
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

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const tokens = await this.token.rotate(refreshToken);
    if (!tokens) {
      throw new AppHttpException('invalid_token', 'Invalid or expired refresh token', HttpStatus.UNAUTHORIZED);
    }
    return tokens;
  }

  async logout(refreshToken: string): Promise<void> {
    await this.token.revoke(refreshToken);
  }

  async resendOtp(dto: ResendOtpDto): Promise<void> {
    const identifier = normalizeIdentifier(dto.identifier);
    const user = await this.users.findByIdentifier(identifier);

    if (!user || user.status !== 'PENDING_VERIFICATION') {
      return;
    }

    const channel: OtpChannel = identifier.kind === 'EMAIL' ? 'EMAIL' : 'PHONE';
    const { plainCode, hashedCode, expiresAt } = await this.otp.prepare();

    await this.tx.run(async (client) => {
      const otpRecord = await this.otp.create(client, user.id, channel, hashedCode, expiresAt);

      await this.outbox.append(client, {
        type: 'otp.send',
        payload: {
          user_id: user.id,
          otp_id: otpRecord.id,
          channel,
          identifier: identifier.normalized,
          plain_code: this.crypto.encrypt(plainCode),
        },
        idempotencyKey: otpRecord.id,
      });
    });
  }
}
