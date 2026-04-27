import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { NormalizedIdentifier } from '../auth/identifier.util';

export interface CreateUserInput {
  email?: string;
  phone?: string;
  passwordHash: string;
}

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(client: Prisma.TransactionClient, input: CreateUserInput): Promise<User> {
    return client.user.create({ data: input });
  }

  findByIdentifier(identifier: NormalizedIdentifier): Promise<User | null> {
    const where =
      identifier.kind === 'EMAIL'
        ? { email: identifier.normalized }
        : { phone: identifier.normalized };
    return this.prisma.user.findUnique({ where });
  }

  markActive(client: Prisma.TransactionClient, id: string): Promise<User> {
    return client.user.update({ where: { id }, data: { status: 'ACTIVE' } });
  }
}
