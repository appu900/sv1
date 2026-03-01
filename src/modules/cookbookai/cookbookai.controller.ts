import { Controller, Get, Post, Delete, UseGuards, Body, Param } from '@nestjs/common';
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

    private resolveUserId(req: any): string {
        const resolved =
            req?.user?.userId ??
            req?.user?.id ??
            req?.user?._id ??
            req?.user?.sub ??
            '';
        return String(resolved || '');
    }

    @Get()
    @Roles('USER')
    @UseGuards(JwtAuthGuard, RolesGuard)
    async getHello(@Request() req) {
     return { message: this.cookbookaiService.getHello(), user: req.user };
    }

    @Get(['/user-recipes', '/recipes'])
    @Roles('USER')
    @UseGuards(JwtAuthGuard, RolesGuard)
    async getAllRecipes(@Request() req) {
        const userId = this.resolveUserId(req);
        const recipes = await this.cookbookaiService.findAllByUser(userId);
        return {
            success: true,
            count: recipes.length,
            data: recipes
        };
    }

    @Get('/recipes/:id')
    @Roles('USER')
    @UseGuards(JwtAuthGuard, RolesGuard)
    async getRecipeById(@Request() req, @Param('id') id: string) {
        const userId = this.resolveUserId(req);
        const recipe = await this.cookbookaiService.findById(id, userId);
        console.log('[getRecipeById] found:', !!recipe);
        if (!recipe) {
            return { success: false, message: 'Recipe not found.' };
        }
        return { success: true, data: recipe };
    }

    @Delete('/recipes/:id')
    @Roles('USER')
    @UseGuards(JwtAuthGuard, RolesGuard)
    async deleteRecipe(@Request() req, @Param('id') id: string) {
        const userId = this.resolveUserId(req);
        const result = await this.cookbookaiService.deleteRecipe(id, userId);
        return result;
    }

    @Post("/add-recipe")
    @Roles('USER')
    @UseGuards(JwtAuthGuard, RolesGuard)
    async addRecipe(@Request() req, @Body() body: AddRecipeDto) {
          try {
            const userId = this.resolveUserId(req);
            if (!userId) {
                return {
                    success: false,
                    message: 'Unable to resolve current user. Please login again.',
                };
            }

            const key = `user:${userId}:cookbookai`;

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

            const aiResponse = await this.cookbookaiService.extractRecipeWithAI(
                body.message,
            );

            if (!aiResponse.success) {
                await this.redisService.decr(key);
                return aiResponse;
            }
            const responsetobeadded = {...aiResponse.data, userid: userId };

            const createResponse = await this.cookbookaiService.createRecipe(responsetobeadded);
            if (createResponse.success && createResponse.data) {
                const doc: any = createResponse.data;
                const plainData = doc.toJSON ? doc.toJSON() : doc;
                plainData._id = String(plainData._id);
                console.log('[addRecipe] returning _id:', plainData._id, 'type:', typeof plainData._id);
                return {
                    success: true,
                    message: 'Recipe added successfully.',
                    data: plainData,
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
        const userId = this.resolveUserId(req);
        await this.redisService.delByPattern(`user:${userId}:cookbookai*`);
        return { message: "Cache invalidated successfully." };
    }
}


