import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);
  constructor(@InjectConnection() private readonly connection: Connection) {
    this.connection.once('open', () =>
      this.logger.log('Database connection established'),
    );
    this.connection.on('error', (err) =>
      this.logger.error(`Database connection error: ${err}`),
    );
  }

  async isConnected(): Promise<boolean> {
    return this.connection.readyState === 1;
  }

  getConnection(): Connection {
    return this.connection;
  }
}
