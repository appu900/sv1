import { Module, Global } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
        dbName: config.get<string>('MONGODB_DBNAME') || 'testdb',
        autoIndex: true,
        retryWrites: true,
        maxPoolSize: 10,
      }),
    }),
  ],
  providers: [DatabaseService],
  exports:[DatabaseService,MongooseModule]
})
export class DatabaseModule {}
