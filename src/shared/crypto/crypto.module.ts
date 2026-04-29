import { Module } from '@nestjs/common';
import { OtpCryptoService } from './otp-crypto.service';

@Module({
  providers: [OtpCryptoService],
  exports: [OtpCryptoService],
})
export class CryptoModule {}
