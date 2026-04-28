import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpChannel, OtpCode, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../shared/prisma/prisma.service';

const MAX_OTP_ATTEMPTS = 5;

@Injectable()
export class OtpService {
  private readonly bcryptCost: number;
  private readonly ttlSeconds: number;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.bcryptCost = Number(config.getOrThrow('BCRYPT_COST'));
    this.ttlSeconds = Number(config.getOrThrow('OTP_TTL_SECONDS'));
  }

  async prepare(): Promise<{ plainCode: string; hashedCode: string; expiresAt: Date }> {
    const plainCode = crypto.randomInt(100000, 1000000).toString();
    const hashedCode = await bcrypt.hash(plainCode, this.bcryptCost);
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    return { plainCode, hashedCode, expiresAt };
  }

  create(
    client: Prisma.TransactionClient,
    userId: string,
    channel: OtpChannel,
    hashedCode: string,
    expiresAt: Date,
  ): Promise<OtpCode> {
    return client.otpCode.create({ data: { userId, channel, hashedCode, expiresAt } });
  }

  findValid(userId: string): Promise<OtpCode | null> {
    return this.prisma.otpCode.findFirst({
      where: { userId, used: false, expiresAt: { gt: new Date() }, attempts: { lt: MAX_OTP_ATTEMPTS } },
      orderBy: { createdAt: 'desc' },
    });
  }

  markUsed(client: Prisma.TransactionClient, id: string): Promise<OtpCode> {
    return client.otpCode.update({ where: { id }, data: { used: true } });
  }

  incrementAttempts(id: string): Promise<OtpCode> {
    return this.prisma.otpCode.update({ where: { id }, data: { attempts: { increment: 1 } } });
  }
}
