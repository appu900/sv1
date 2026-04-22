import { Controller, Get, Post, Delete, UseGuards, Body, Param, BadRequestException, NotFoundException } from '@nestjs/common';
import { CookbookaiService } from './cookbookai.service';
import { CookbookaiProducer } from './cookbookai.producer';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/role.decorators';
import { Request } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import { AddRecipeDto } from './dto/add-recipe.dto';
import { GenerateFromIngredientsDto } from './dto/generate-from-ingredients.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from 'src/database/schemas/user.auth.schema';

@Controller('cookbookai')
export class CookbookaiController {
    constructor(
        private readonly cookbookaiService: CookbookaiService,
        private readonly cookbookaiProducer: CookbookaiProducer,
        private readonly redisService: RedisService,
        @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    ) { }

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

    private async resolveUserCountry(userId: string): Promise<string | undefined> {
        const user = await this.userModel.findById(userId).select('country').lean().exec();
        return (user as any)?.country;
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
        if (!id || !/^[a-f\d]{24}$/i.test(id)) {
            throw new BadRequestException('Invalid recipe ID.');
        }

        const recipe = await this.cookbookaiService.findById(id, userId);
        if (!recipe) {
            throw new NotFoundException('Recipe not found.');
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

            // Lifetime limit of 3 total recipes (all types combined)
            const totalCount = await this.cookbookaiService.getTotalUserRecipeCount(userId);
            if (totalCount >= 3) {
                return {
                    success: false,
                    message: 'You have used all 3 of your free recipe generations. Stay tuned for our subscription plan!',
                    limitReached: true,
                    count: totalCount,
                    limit: 3,
                };
            }

            // Create a pending row immediately so the app can show a stable
            // loading card while background generation runs.
            const pendingRecipe = await this.cookbookaiService.createPendingRecipe(
                userId,
                body.message,
            );

            // Queue the recipe extraction as a background job linked to this row.
            const jobId = await this.cookbookaiProducer.enqueueRecipeExtraction(
                userId,
                body.message,
                String(pendingRecipe._id),
            );

            return {
                success: true,
                queued: true,
                jobId,
                data: pendingRecipe,
                message: 'Your recipe is being generated! We\'ll send you a notification when it\'s ready.',
            };
        } catch (error) {
            console.error('Error in addRecipe:', error);
            return {
                success: false,
                message: 'An error occurred while processing your request.',
            };
        }
    }
    @Get("/ai-generation-count")
    @Roles('USER')
    @UseGuards(JwtAuthGuard, RolesGuard)
    async getAiGenerationCount(@Request() req) {
        const userId = this.resolveUserId(req);
        const count = await this.cookbookaiService.getTotalUserRecipeCount(userId);
        return { success: true, count, limit: 3, remaining: Math.max(0, 3 - count) };
    }

    @Post("/generate-from-ingredients")
    @Roles('USER')
    @UseGuards(JwtAuthGuard, RolesGuard)
    async generateFromIngredients(@Request() req, @Body() body: GenerateFromIngredientsDto) {
        try {
            const userId = this.resolveUserId(req);
            if (!userId) {
                return {
                    success: false,
                    message: 'Unable to resolve current user. Please login again.',
                };
            }

            // Lifetime limit of 3 total recipes (all types combined)
            const existingCount = await this.cookbookaiService.getTotalUserRecipeCount(userId);
            if (existingCount >= 3) {
                return {
                    success: false,
                    message: 'You have used all 3 of your free recipe generations. Stay tuned for our subscription plan!',
                    limitReached: true,
                    count: existingCount,
                    limit: 3,
                };
            }

            const pendingRecipe = await this.cookbookaiService.createPendingRecipe(
                userId,
                `AI Recipe from: ${body.ingredients.slice(0, 5).join(', ')}${body.ingredients.length > 5 ? '...' : ''}`,
                'ai_ingredients',
            );

            await this.cookbookaiService.updateRecipeSource(String(pendingRecipe._id), userId, 'ai_ingredients');

            const country = await this.resolveUserCountry(userId);

            const jobId = await this.cookbookaiProducer.enqueueRecipeFromIngredients(
                userId,
                body.ingredients,
                body.preference,
                String(pendingRecipe._id),
                country,
            );

            return {
                success: true,
                queued: true,
                jobId,
                data: pendingRecipe,
                message: 'Your recipe is being generated! We\'ll notify you when it\'s ready.',
                remaining: Math.max(0, 3 - existingCount - 1),
            };
        } catch (error) {
            console.error('Error in generateFromIngredients:', error);
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

    @Get("/dev-reset-limits")
    async devResetLimits() {
        await this.redisService.delByPattern(`user:*:cookbookai*`);
        return { message: "All cookbookai rate limits cleared." };
    }
}


