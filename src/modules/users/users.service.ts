import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { NormalizedIdentifier } from '../auth/identifier.util';
import { CreateUserInput, UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  create(client: Prisma.TransactionClient, input: CreateUserInput): Promise<User> {
    return this.repo.create(client, input);
  }

  findByIdentifier(identifier: NormalizedIdentifier): Promise<User | null> {
    return this.repo.findByIdentifier(identifier);
  }

  markActive(client: Prisma.TransactionClient, id: string): Promise<User> {
    return this.repo.markActive(client, id);
  }
}
