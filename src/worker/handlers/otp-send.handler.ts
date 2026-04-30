import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OtpCryptoService } from '../../shared/crypto/otp-crypto.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { HandlerRegistry } from '../handler-registry';

interface OtpSendPayload {
  otp_id: string;
  channel: string;
  identifier: string;
}

@Injectable()
export class OtpSendHandler implements OnModuleInit {
  private readonly logger = new Logger(OtpSendHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: HandlerRegistry,
    private readonly crypto: OtpCryptoService,
  ) {}

  onModuleInit(): void {
    this.registry.register('otp.send', this.handle.bind(this));
  }

  async handle(payload: unknown): Promise<void> {
    const { otp_id, channel, identifier } = payload as OtpSendPayload;

    const otp = await this.prisma.otpCode.findUnique({ where: { id: otp_id } });
    if (!otp) {
      throw new Error(`OTP record not found: ${otp_id}`);
    }

    if (otp.sent) {
      this.logger.debug({ otp_id }, 'OTP already sent — idempotent skip');
      return;
    }

    // Mock delivery — decrypt and log so local dev can read the code.
    // A real impl would pass decryptedCode to an SMS/email provider and never log it.
    const decryptedCode = this.crypto.decrypt(otp.encryptedCode);
    this.logger.log({ otp_id, channel, identifier, code: decryptedCode }, 'OTP send (mock)');

    await this.prisma.otpCode.update({ where: { id: otp_id }, data: { sent: true } });
  }
}
