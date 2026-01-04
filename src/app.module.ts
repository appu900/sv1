import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';

import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { RedisModule } from './redis/redis.module';
import { UserModule } from './modules/user/user.module';
import { HackModule } from './modules/hack/hack.module';
import { ImageUploadModule } from './modules/image-upload/image-upload.module';
import { IngredientsModule } from './modules/ingredients/ingredients.module';
import { StickerModule } from './modules/sticker/sticker.module';
import { SponsersModule } from './modules/sponsers/sponsers.module';
import { AdminModule } from './modules/admin/admin.module';
import { HackOrTipModule } from './modules/hack-or-tip/hack-or-tip.module';
import { CommunityGroupsModule } from './modules/community-groups/community-groups.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    RedisModule,
    UserModule,
    HackModule,
    ImageUploadModule,
    IngredientsModule,
    StickerModule,
    SponsersModule,
    AdminModule,
    HackOrTipModule,
    CommunityGroupsModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
