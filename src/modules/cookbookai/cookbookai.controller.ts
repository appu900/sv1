import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CookbookaiService } from './cookbookai.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/role.decorators';
import { Request } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
@Controller('cookbookai')
export class CookbookaiController {
    constructor(private readonly cookbookaiService: CookbookaiService, private readonly redisService: RedisService) { }
    @Get()
    @Roles('USER')
    @UseGuards(JwtAuthGuard, RolesGuard)
    async getHello(@Request() req) {
     return { message: this.cookbookaiService.getHello(), user: req.user };
    }
    @Post("/add-recipe")
    @Roles('USER')
    @UseGuards(JwtAuthGuard, RolesGuard)
    async addRecipe(@Request() req) {
          try {
            const user = req.user;
            const key = `user:${user.userId}:cookbookai`;

            const currentCount = await this.redisService.incr(key);

            if (currentCount === 1) {
                await this.redisService.expire(key, 60 * 60 * 24); 
            }

            if (currentCount > 5) {
                return {
                    success: false,
                    message: "You have reached the maximum limit of 5 requests per day.",
                    limit: 5
                };
            }

            return {
                success: true,
                message: "Recipe added successfully!",
                currentCount,
            };

        }
        catch (error) {
            console.error('Error in getHello:', error);
            return 'An error occurred while processing your request.';
        }
    }
    @Get("/invalidate-cache")
    @Roles('USER')
    @UseGuards(JwtAuthGuard, RolesGuard)
    async invalidateCache(@Request() req) {
        await this.redisService.delByPattern(`user:${req.user.userId}:cookbookai*`);
        return { message: "Cache invalidated successfully." };
    }
}


