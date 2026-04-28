import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { HandlerRegistry } from '../handler-registry';

interface OtpSendPayload {
  otp_id: string;
  channel: string;
  identifier: string;
  plain_code: string;
}

@Injectable()
export class OtpSendHandler implements OnModuleInit {
  private readonly logger = new Logger(OtpSendHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: HandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register('otp.send', this.handle.bind(this));
  }

  async handle(payload: unknown): Promise<void> {
    const { otp_id, channel, identifier, plain_code } = payload as OtpSendPayload;

    const otp = await this.prisma.otpCode.findUnique({ where: { id: otp_id } });
    if (!otp) {
      throw new Error(`OTP record not found: ${otp_id}`);
    }

    if (otp.sent) {
      return;
    }

    // Mock delivery — real impl would call SMS/email provider with plain_code here.
    // Never log plain_code; log only safe metadata.
    void plain_code;
    this.logger.log({ otp_id, channel, identifier }, 'OTP send (mock)');

    await this.prisma.otpCode.update({ where: { id: otp_id }, data: { sent: true } });
  }
}
