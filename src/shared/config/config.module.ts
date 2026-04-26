import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envSchema } from './env.schema';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config: Record<string, unknown>) => {
        const result = envSchema.safeParse(config);
        if (!result.success) {
          const messages = result.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ');
          throw new Error(`Config validation failed — ${messages}`);
        }
        return result.data;
      },
    }),
  ],
})
export class AppConfigModule {}
