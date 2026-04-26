import { Module } from '@nestjs/common';
import { AppConfigModule } from './shared/config/config.module';

@Module({
  imports: [AppConfigModule],
  controllers: [],
  providers: [],
})
export class ApiModule {}
