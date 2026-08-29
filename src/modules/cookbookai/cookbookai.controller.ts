import { Controller, Get, Post, Patch, Delete, UseGuards, Body, Param, BadRequestException, NotFoundException, UseInterceptors, UploadedFile } from '@nestjs/common';
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
import { FileInterceptor } from '@nestjs/platform-express';
import { ImageUploadService } from '../image-upload/image-upload.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { UNLIMITED } from '../subscription/subscription.constants';

@Controller('cookbookai')
export class CookbookaiController {
    constructor(
        private readonly cookbookaiService: CookbookaiService,
        private readonly cookbookaiProducer: CookbookaiProducer,
        private readonly redisService: RedisService,
        private readonly imageUploadService: ImageUploadService,
        @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
        private readonly subscriptionService: SubscriptionService,
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

    private getGenerationLimitMessage(used: number, limit: number, plan: string): string {
        if (plan === 'basic') {
            return `You have used all ${limit} of your monthly AI recipe generations. Upgrade to Saveful Hero or Legend for more!`;
        }
        return `You have reached this month's limit of ${limit} AI recipes on your ${plan} plan.`;
    }

    /**
     * Return a compact quota block the app can use to show "X left — upgrade
     * to continue" style warnings inline with success responses.
     */
    private async getAiMealQuota(userId: string) {
        const snapshot = await this.subscriptionService.getSubscriptionSnapshot(userId);
        const { used, limit, remaining } = await this.subscriptionService.checkLimit(
            userId,
            'aiMealsUsed',
        );
        const unlimited = limit === UNLIMITED;
        return {
            plan: snapshot.plan,
            used,
            limit: unlimited ? null : limit,
            remaining: unlimited ? null : remaining,
            unlimited,
            // True when the user is within the last 2 generations — UI can
            // render a yellow banner / toast.
            warn: !unlimited && remaining <= 2,
            // True when the user has exhausted their quota and the next call
            // will be rejected with LIMIT_REACHED.
            exhausted: !unlimited && remaining <= 0,
        };
    }

    /**
     * Subscription-aware monthly AI meal quota check.
     * Returns an error payload the frontend can show as a paywall trigger, or
     * null when the user is under quota.
     */
    private async enforceAiMealQuota(userId: string) {
        const snapshot = await this.subscriptionService.getSubscriptionSnapshot(userId);
        const { limit, used, remaining } = await this.subscriptionService.checkLimit(
            userId,
            'aiMealsUsed',
        );
        if (limit !== UNLIMITED && used >= limit) {
            return {
                success: false,
                code: 'LIMIT_REACHED',
                limit: 'aiMealsPerMonth',
                message: this.getGenerationLimitMessage(used, limit, snapshot.plan),
                limitReached: true,
                plan: snapshot.plan,
                count: used,
                cap: limit,
                remaining,
            };
        }
        return null;
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

          
            const existingCookbookCount =
                await this.cookbookaiService.getTotalUserRecipeCount(userId);
            await this.subscriptionService.enforceLiveLimit(
                userId,
                'cookbooks',
                existingCookbookCount,
                1,
            );

            // Monthly AI meal quota enforcement (backend source of truth).
            const quotaError = await this.enforceAiMealQuota(userId);
            if (quotaError) return quotaError;

        
            await this.subscriptionService.incrementUsage(userId, 'aiMealsUsed');

        
            let pendingRecipe: any;
            let jobId: string;
            try {
                pendingRecipe = await this.cookbookaiService.createPendingRecipe(
                    userId,
                    body.message,
                );
                jobId = await this.cookbookaiProducer.enqueueRecipeExtraction(
                    userId,
                    body.message,
                    String(pendingRecipe._id),
                );
            } catch (e) {
                await this.subscriptionService
                    .refundUsage(userId, 'aiMealsUsed')
                    .catch(() => undefined);
                throw e;
            }

            const quota = await this.getAiMealQuota(userId);

            return {
                success: true,
                queued: true,
                jobId,
                data: pendingRecipe,
                quota,
                message: quota.warn
                    ? `Recipe queued. ${quota.remaining} AI recipe${quota.remaining === 1 ? '' : 's'} left this month — upgrade for more.`
                    : 'Your recipe is being generated! We\'ll send you a notification when it\'s ready.',
            };
        } catch (error: any) {
            // Let paywall / auth / validation errors propagate with their
            // original status so the client can open the correct paywall.
            if (error?.status && error.status !== 500) throw error;
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
        const { used, limit, remaining } = await this.subscriptionService.checkLimit(
            userId,
            'aiMealsUsed',
        );
        return {
            success: true,
            count: used,
            limit: limit === UNLIMITED ? null : limit,
            remaining: limit === UNLIMITED ? null : remaining,
            unlimited: limit === UNLIMITED,
        };
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

            // Cookbook total-count cap (basic = 5 saved recipes).
            const existingCookbookCount =
                await this.cookbookaiService.getTotalUserRecipeCount(userId);
            await this.subscriptionService.enforceLiveLimit(
                userId,
                'cookbooks',
                existingCookbookCount,
                1,
            );

            // Monthly AI meal quota enforcement (backend source of truth).
            const quotaError = await this.enforceAiMealQuota(userId);
            if (quotaError) return quotaError;

            await this.subscriptionService.incrementUsage(userId, 'aiMealsUsed');

            let pendingRecipe: any;
            let jobId: string;
            try {
                pendingRecipe = await this.cookbookaiService.createPendingRecipe(
                    userId,
                    `AI Recipe from: ${body.ingredients.slice(0, 5).join(', ')}${body.ingredients.length > 5 ? '...' : ''}`,
                    'ai_ingredients',
                );

                await this.cookbookaiService.updateRecipeSource(String(pendingRecipe._id), userId, 'ai_ingredients');

                const country = await this.resolveUserCountry(userId);

                jobId = await this.cookbookaiProducer.enqueueRecipeFromIngredients(
                    userId,
                    body.ingredients,
                    body.preference,
                    String(pendingRecipe._id),
                    country,
                );
            } catch (e) {
                await this.subscriptionService
                    .refundUsage(userId, 'aiMealsUsed')
                    .catch(() => undefined);
                throw e;
            }

            const quota = await this.getAiMealQuota(userId);

            return {
                success: true,
                queued: true,
                jobId,
                data: pendingRecipe,
                quota,
                message: quota.warn
                    ? `Recipe queued. ${quota.remaining} AI recipe${quota.remaining === 1 ? '' : 's'} left this month — upgrade for more.`
                    : 'Your recipe is being generated! We\'ll notify you when it\'s ready.',
            };
        } catch (error: any) {
            if (error?.status && error.status !== 500) throw error;
            console.error('Error in generateFromIngredients:', error);
            return {
                success: false,
                message: 'An error occurred while processing your request.',
            };
        }
    }

    @Patch('/recipes/:id/hero-image')
    @Roles('USER')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @UseInterceptors(FileInterceptor('photo'))
    async uploadHeroImage(
        @Request() req,
        @Param('id') id: string,
        @UploadedFile() file: Express.Multer.File,
    ) {
        const userId = this.resolveUserId(req);
        if (!id || !/^[a-f\d]{24}$/i.test(id)) {
            throw new BadRequestException('Invalid recipe ID.');
        }
        if (!file) {
            throw new BadRequestException('No photo file provided.');
        }
        const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
        if (!allowedMimes.includes(file.mimetype)) {
            throw new BadRequestException('Invalid file type. Only JPEG, PNG, WEBP, HEIC images are allowed.');
        }
        const imageUrl = await this.imageUploadService.uploadFile(file, 'saveful/cookbook/hero-images');
        const updated = await this.cookbookaiService.updateHeroImage(id, userId, imageUrl);
        if (!updated) {
            throw new NotFoundException('Recipe not found.');
        }
        return { success: true, heroImageUrl: imageUrl, data: updated };
    }

    @Patch('/recipes/reorder')
    @Roles('USER')
    @UseGuards(JwtAuthGuard, RolesGuard)
    async reorderRecipes(@Request() req, @Body() body: { recipeIds: string[] }) {
        const userId = this.resolveUserId(req);
        return this.cookbookaiService.reorderRecipes(userId, body?.recipeIds || []);
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
    @Roles('ADMIN')
    @UseGuards(JwtAuthGuard, RolesGuard)
    async devResetLimits() {
        // Gated behind admin role. Previously unauthenticated, which let
        // anyone wipe cookbookai rate-limit state for every user.
        await this.redisService.delByPattern(`user:*:cookbookai*`);
        return { message: "All cookbookai rate limits cleared." };
    }
}


