import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../shared/http/public.decorator';
import { RateLimit } from '../../shared/http/rate-limit.guard';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ prefix: 'register', key: 'ip', capacity: 5, refillPerSec: 5 / 600 })
  register(@Body() dto: RegisterDto): Promise<{ userId: string }> {
    return this.auth.register(dto);
  }

  @Post('verify-otp')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ prefix: 'verify-otp', key: 'identifier', capacity: 5, refillPerSec: 5 / 300 })
  verifyOtp(@Body() dto: VerifyOtpDto): Promise<{ accessToken: string; refreshToken: string }> {
    return this.auth.verifyOtp(dto);
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit(
    { prefix: 'login', key: 'ip', capacity: 10, refillPerSec: 10 / 60 },
    { prefix: 'login', key: 'identifier', capacity: 5, refillPerSec: 5 / 60 },
  )
  login(@Body() dto: LoginDto): Promise<{ accessToken: string; refreshToken: string }> {
    return this.auth.login(dto);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto): Promise<{ accessToken: string; refreshToken: string }> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  logout(@Body() dto: LogoutDto): Promise<void> {
    return this.auth.logout(dto.refreshToken);
  }

  @Post('resend-otp')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ prefix: 'resend-otp', key: 'identifier', capacity: 3, refillPerSec: 3 / 600 })
  resendOtp(@Body() dto: ResendOtpDto): Promise<void> {
    return this.auth.resendOtp(dto);
  }
}
