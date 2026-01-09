import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from 'src/database/schemas/user.auth.schema';
import { UserFoodAnalyticalProfileSchema, UserFoodAnalyticsProfile } from 'src/database/schemas/user.food.analyticsProfile.schema';

@Module({
  imports:[MongooseModule.forFeature([
    {name:User.name,schema:UserSchema},
    {name:UserFoodAnalyticsProfile.name,schema:UserFoodAnalyticalProfileSchema}
  ])],
  controllers: [UserController],
  providers: [UserService],
  exports:[UserService]
})
export class UserModule {}
