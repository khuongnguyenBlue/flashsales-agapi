import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpChannel, OtpCode, Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { OtpCryptoService } from '../../shared/crypto/otp-crypto.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

const MAX_OTP_ATTEMPTS = 5;

@Injectable()
export class OtpService {
  private readonly ttlSeconds: number;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly crypto: OtpCryptoService,
  ) {
    this.ttlSeconds = Number(config.getOrThrow('OTP_TTL_SECONDS'));
  }

  async prepare(): Promise<{ encryptedCode: string; expiresAt: Date }> {
    const plainCode = crypto.randomInt(100000, 1000000).toString();
    const encryptedCode = this.crypto.encrypt(plainCode);
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    return { encryptedCode, expiresAt };
  }

  create(
    client: Prisma.TransactionClient,
    userId: string,
    channel: OtpChannel,
    encryptedCode: string,
    expiresAt: Date,
  ): Promise<OtpCode> {
    return client.otpCode.create({ data: { userId, channel, encryptedCode, expiresAt } });
  }

  findValid(userId: string): Promise<OtpCode | null> {
    return this.prisma.otpCode.findFirst({
      where: { userId, used: false, expiresAt: { gt: new Date() }, attempts: { lt: MAX_OTP_ATTEMPTS } },
      orderBy: { createdAt: 'desc' },
    });
  }

  verify(submittedCode: string, encryptedCode: string): boolean {
    const plainCode = this.crypto.decrypt(encryptedCode);
    return plainCode === submittedCode;
  }

  getDecryptedCode(encryptedCode: string): string {
    return this.crypto.decrypt(encryptedCode);
  }

  markUsed(client: Prisma.TransactionClient, id: string): Promise<OtpCode> {
    return client.otpCode.update({ where: { id }, data: { used: true } });
  }

  incrementAttempts(id: string): Promise<OtpCode> {
    return this.prisma.otpCode.update({ where: { id }, data: { attempts: { increment: 1 } } });
  }
}
