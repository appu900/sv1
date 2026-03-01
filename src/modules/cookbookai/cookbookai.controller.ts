import { Controller, Get, Post, UseGuards, Body } from '@nestjs/common';
import { CookbookaiService } from './cookbookai.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/role.decorators';
import { Request } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import { AddRecipeDto } from './dto/add-recipe.dto';

@Controller('cookbookai')
export class CookbookaiController {
    constructor(private readonly cookbookaiService: CookbookaiService, private readonly redisService: RedisService) { }
    @Get()
    @Roles('USER')
    @UseGuards(JwtAuthGuard, RolesGuard)
    async getHello(@Request() req) {
     return { message: this.cookbookaiService.getHello(), user: req.user };
    }

    @Get('/recipes')
    @Roles('USER')
    @UseGuards(JwtAuthGuard, RolesGuard)
    async getAllRecipes() {
        const recipes = await this.cookbookaiService.findAll();
        return {
            success: true,
            count: recipes.length,
            data: recipes
        };
    }

    @Post("/add-recipe")
    @Roles('USER')
    @UseGuards(JwtAuthGuard, RolesGuard)
    async addRecipe(@Request() req, @Body() body: AddRecipeDto) {
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

            // Call admin AI to process the recipe request
            const aiResponse = await this.cookbookaiService.callAdminAi(
                body.message, 
                user.userId
            );

            if (!aiResponse.success) {
                return aiResponse;
            }
            const responsetobeadded = {...aiResponse.data, userid: user.userId };

            const createResponse = await this.cookbookaiService.createRecipe(responsetobeadded);
            console.log("Create Response:", createResponse);
            if (createResponse.success) {
                return {
                    success: true,
                    message: 'Recipe added successfully.',
                    data: createResponse.data
                };
            }
            return {
                success: false,
                message: 'Failed to add recipe.',
            };
        }
        catch (error) {
            console.error('Error in addRecipe:', error);
            return {
                success: false,
                message: 'An error occurred while processing your request.',
            };
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


