import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TransactionService {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(fn: (client: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (client) => {
      await client.$executeRawUnsafe("SET LOCAL statement_timeout = '2000'");
      await client.$executeRawUnsafe("SET LOCAL lock_timeout = '1000'");
      await client.$executeRawUnsafe("SET LOCAL idle_in_transaction_session_timeout = '5000'");
      return fn(client);
    });
  }
}
