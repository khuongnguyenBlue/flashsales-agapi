import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../../src/shared/prisma/prisma.module';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { UsersModule } from '../../src/modules/users/users.module';
import { UsersService } from '../../src/modules/users/users.service';
import { startInfra, type InfraHandles } from '../helpers/testcontainers';

describe('UsersService (e2e)', () => {
  let infra: InfraHandles;
  let prisma: PrismaService;
  let users: UsersService;

  beforeAll(async () => {
    infra = await startInfra();
    process.env.DATABASE_URL = infra.databaseUrl;

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        UsersModule,
      ],
    }).compile();

    prisma = module.get(PrismaService);
    users = module.get(UsersService);
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
    await infra.shutdown();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  it('create with email → findByIdentifier returns the user', async () => {
    await prisma.$transaction(async (client) => {
      await users.create(client, {
        email: 'alice@test.com',
        passwordHash: 'hashed',
      });
    });

    const found = await users.findByIdentifier({
      kind: 'EMAIL',
      normalized: 'alice@test.com',
    });
    expect(found).not.toBeNull();
    expect(found!.email).toBe('alice@test.com');
    expect(found!.status).toBe('PENDING_VERIFICATION');
  });

  it('create with phone → findByIdentifier by phone returns the user', async () => {
    await prisma.$transaction(async (client) => {
      await users.create(client, {
        phone: '+84912345678',
        passwordHash: 'hashed',
      });
    });

    const found = await users.findByIdentifier({
      kind: 'PHONE',
      normalized: '+84912345678',
    });
    expect(found).not.toBeNull();
    expect(found!.phone).toBe('+84912345678');
  });

  it('create with neither email nor phone → DB CHECK rejects', async () => {
    await expect(
      prisma.$transaction((client) =>
        users.create(client, { passwordHash: 'hashed' }),
      ),
    ).rejects.toThrow();
  });
});
