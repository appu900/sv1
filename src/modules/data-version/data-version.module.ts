import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DataVersion,
  DataVersionSchema,
} from '../../database/schemas/data-version.schema';
import { DataVersionController } from './data-version.controller';
import { DataVersionService } from './data-version.service';

/**
 * Global so that any feature service can bump its collection's version without
 * every module having to import this one.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DataVersion.name, schema: DataVersionSchema },
    ]),
  ],
  controllers: [DataVersionController],
  providers: [DataVersionService],
  exports: [DataVersionService],
})
export class DataVersionModule {}
