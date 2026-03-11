import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super();
  }

  async onModuleInit() {
    await this.$connect();

    try {
      await this.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
      await this.$queryRawUnsafe('PRAGMA busy_timeout = 10000;');
    } catch (error) {
      this.logger.warn(
        `Failed to apply SQLite runtime pragmas: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
