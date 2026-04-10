import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UnauthorizedException,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { FoodItemService } from './food-item.service';
import { UserCustomFoodService } from './user-custom-food.service';
import { NutritionService } from './nutrition.service';
import { OpenFoodFactsProvider } from './providers/open-food-facts.provider';
import { HydraSearchService } from './hydra-search.service';
import { BarcodeLookupService } from './barcode-lookup.service';
import {
  BarcodeLookupDto,
  FoodSearchQueryDto,
} from './dto/food-query.dto';
import {
  CreateCustomFoodDto,
  UpdateCustomFoodDto,
} from './dto/custom-food.dto';
import {
  CreateLogEntryDto,
  DailyQueryDto,
  UpdateLogEntryDto,
} from './dto/log-entry.dto';
import { AiEstimateDto } from './dto/ai-estimate.dto';
import { PhotoQuickAddDto } from './dto/photo-quick-add.dto';
import {
  CreateHealthProfileDto,
  UpdateHealthProfileDto,
  UpdateDailyTargetsDto,
  UpdateWeightDto,
  LogWaterDto,
} from './dto/health-profile.dto';
import { NutritionAiService } from './nutrition-ai.service';
import { RecipeNutritionService } from './recipe-nutrition.service';
import { HealthProfileService } from './health-profile.service';
import { ProductImageAnalysisService } from './product-image-analysis.service';
import { ImageUploadService } from '../image-upload/image-upload.service';
import { isValidObjectId } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../database/schemas/user.auth.schema';


@Controller('nutrition')
@UseGuards(JwtAuthGuard)
export class NutritionController {
  private readonly logger = new Logger(NutritionController.name);

  constructor(
    private readonly foodItemService: FoodItemService,
    private readonly userCustomFoodService: UserCustomFoodService,
    private readonly nutritionService: NutritionService,
    private readonly openFoodFacts: OpenFoodFactsProvider,
    private readonly hydraSearch: HydraSearchService,
    private readonly nutritionAi: NutritionAiService,
    private readonly recipeNutrition: RecipeNutritionService,
    private readonly healthProfileService: HealthProfileService,
    private readonly barcodeLookup: BarcodeLookupService,
    private readonly productImageAnalysis: ProductImageAnalysisService,
    private readonly imageUpload: ImageUploadService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  private resolveUserId(req: any): string {
    const u = req?.user ?? {};
    const id = u._id ?? u.userId ?? u.id ?? u.sub;
    if (!id) throw new UnauthorizedException();
    return String(id);
  }

  private async resolveUserCountry(userId: string): Promise<string | undefined> {
    const user = await this.userModel.findById(userId).select('country').lean().exec();
    return (user as any)?.country;
  }


  @Get('foods/search')
  async searchFoods(@Request() req: any, @Query() query: FoodSearchQueryDto) {
    this.resolveUserId(req); // ensure authenticated user
    return this.hydraSearch.search(query.q ?? '', {
      limit: query.limit ?? 20,
      locale: query.locale,
    });
  }

 
  @Get('foods/:id')
  async getFood(@Param('id') id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid food id');
    }
    return this.foodItemService.findById(id);
  }

 
  @Post('foods/barcode')
  @HttpCode(HttpStatus.OK)
  async lookupBarcode(@Body() dto: BarcodeLookupDto) {
    const result = await this.barcodeLookup.lookup(dto.barcode);
    if (!result) {
      this.logger.warn(`Barcode ${dto.barcode} not found in any data source`);
      throw new NotFoundException(
        `No product found for barcode ${dto.barcode}`,
      );
    }
    return result;
  }

  @Post('foods/analyze-image')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'image', maxCount: 1 },       // legacy single-image
        { name: 'barcode', maxCount: 1 },      // barcode close-up
        { name: 'nutrition', maxCount: 1 },    // nutrition label
        { name: 'front', maxCount: 1 },        // product front/name
      ],
      {
        limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max per file
        fileFilter: (_req, file, cb) => {
          if (!file.mimetype.startsWith('image/')) {
            cb(new BadRequestException('Only image files are allowed'), false);
            return;
          }
          cb(null, true);
        },
      },
    ),
  )
  async analyzeProductImage(
    @Request() req: any,
    @UploadedFiles() files: { image?: Express.Multer.File[]; barcode?: Express.Multer.File[]; nutrition?: Express.Multer.File[]; front?: Express.Multer.File[] },
  ) {
    this.resolveUserId(req);

    const barcodeFile = files?.barcode?.[0];
    const nutritionFile = files?.nutrition?.[0];
    const frontFile = files?.front?.[0];
    const legacyFile = files?.image?.[0];

    // Multi-image mode: at least one of barcode/nutrition/front provided
    const hasMultiImages = !!(barcodeFile || nutritionFile || frontFile);

    if (!hasMultiImages && !legacyFile) {
      throw new BadRequestException('At least one product image is required');
    }

    let analysis;

    if (hasMultiImages) {
      // New multi-image analysis
      const images: {
        barcode?: { base64: string; mimeType: string };
        nutrition?: { base64: string; mimeType: string };
        front?: { base64: string; mimeType: string };
      } = {};

      if (barcodeFile?.buffer?.length) {
        images.barcode = { base64: barcodeFile.buffer.toString('base64'), mimeType: barcodeFile.mimetype };
      }
      if (nutritionFile?.buffer?.length) {
        images.nutrition = { base64: nutritionFile.buffer.toString('base64'), mimeType: nutritionFile.mimetype };
      }
      if (frontFile?.buffer?.length) {
        images.front = { base64: frontFile.buffer.toString('base64'), mimeType: frontFile.mimetype };
      }

      analysis = await this.productImageAnalysis.analyzeProductImage(images);
    } else {
      // Legacy single-image mode
      const file = legacyFile!;
      if (!file.buffer || file.buffer.length === 0) {
        throw new BadRequestException('Image file is required');
      }
      const base64 = file.buffer.toString('base64');
      analysis = await this.productImageAnalysis.analyzeProductImage(base64, file.mimetype);
    }

    // 2) If AI found a barcode, check if product already exists in DB
    if (analysis.barcode) {
      const existing = await this.barcodeLookup.lookup(analysis.barcode);
      if (existing) {
        this.logger.log(
          `Image analysis found barcode ${analysis.barcode} — returning existing product`,
        );
        return { source: existing.source, item: existing.item, fromImage: true };
      }
    }

    // 3) Check if a product with this name already exists in DB
    const existingByName = await this.foodItemService.findExistingProduct(
      analysis.productName.toLowerCase(),
      analysis.brand,
    );
    if (existingByName) {
      this.logger.log(
        `Found existing product "${existingByName.displayName}" — returning instead of creating duplicate`,
      );
      return { source: existingByName.source ?? 'catalog', item: existingByName, fromImage: true };
    }

    // 4) Upload product image to S3 (prefer front, then nutrition, then barcode, then legacy)
    const uploadFile = frontFile || nutritionFile || barcodeFile || legacyFile;
    let imageUrl: string | null = null;
    try {
      if (uploadFile) {
        imageUrl = await this.imageUpload.uploadFile(uploadFile, 'product-images');
      }
    } catch (err) {
      this.logger.warn(`Failed to upload product image: ${(err as Error).message}`);
      // Non-fatal — continue without the image URL
    }

    // 5) Convert analysis result to food item and save
    const normalized = this.productImageAnalysis.analysisToNormalizedFood(
      analysis,
      imageUrl,
    );
    const saved = await this.foodItemService.upsert(normalized);

    return {
      source: 'image-ai',
      item: saved,
      analysis: {
        confidence: analysis.confidence,
        barcodeDetected: !!analysis.barcode,
      },
      fromImage: true,
    };
  }

  @Post('foods/identify-food')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          cb(new BadRequestException('Only image files are allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async identifyFoodFromImage(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Query('limit') limit?: string,
    @Query('locale') locale?: string,
  ) {
    this.resolveUserId(req);

    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Image file is required');
    }

    const base64 = file.buffer.toString('base64');
    const identified = await this.nutritionAi.identifyFoodFromImage(
      base64,
      file.mimetype,
    );

    if (!identified.primaryFood) {
      throw new NotFoundException('Could not identify any food in the image');
    }

    // Search hydra with the identified primary food name
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    const safeLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 20;

    const searchResults = await this.hydraSearch.search(
      identified.primaryFood,
      { limit: safeLimit, locale: locale ?? undefined },
    );

    return {
      identified,
      searchResults,
    };
  }

  /* ─── Photo Quick-Add ──────────────────────────────── */

  @Post('foods/photo-quick-add')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          cb(new BadRequestException('Only image files are allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async photoQuickAdd(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: PhotoQuickAddDto,
  ) {
    const userId = this.resolveUserId(req);

    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Image file is required');
    }

    const country = await this.resolveUserCountry(userId);

    // 1) AI: identify food from photo + user hints, estimate full nutrition
    const base64 = file.buffer.toString('base64');
    const analysis = await this.nutritionAi.analyzeAndEstimateFoodFromPhoto(
      base64,
      file.mimetype,
      dto.description,
      dto.servingLabel,
      dto.servingGrams,
      country,
    );

    // 2) Upload photo to S3 (non-fatal if it fails)
    let imageUrl: string | null = null;
    try {
      imageUrl = await this.imageUpload.uploadFile(file, 'photo-food');
    } catch (err) {
      this.logger.warn(`Failed to upload food photo: ${(err as Error).message}`);
    }

    // 3) Save as a user custom food with AI-estimated nutrition
    const customFood = await this.userCustomFoodService.createFromPhotoAnalysis(
      userId,
      {
        name: analysis.primaryFoodName,
        servingLabel:
          dto.servingLabel ??
          (analysis.foods.length === 1
            ? analysis.foods[0].servingLabel
            : '1 plate (as photographed)'),
        servingGrams:
          dto.servingGrams ??
          analysis.foods.reduce((sum, f) => sum + f.servingGrams, 0),
        perServing: analysis.totalPerServing,
        notes: dto.description ?? undefined,
        imageUrl,
      },
    );

    // 4) Optionally auto-log to daily intake
    let logEntry: any = null;
    if (dto.autoLog) {
      logEntry = await this.nutritionService.logEntry(userId, {
        ref: { kind: 'custom' as any, customFoodId: String(customFood._id) },
        portion: { mode: 'serving' as any, servings: 1 },
        mealSlot: dto.mealSlot,
        date: dto.date,
        freeformFacts: undefined,
      });
    }

    return {
      analysis: {
        foods: analysis.foods,
        totalNutrition: analysis.totalPerServing,
        primaryFoodName: analysis.primaryFoodName,
        confidence: analysis.confidence,
      },
      customFood,
      imageUrl,
      logged: dto.autoLog ? { entryId: logEntry?.entryId, date: logEntry?.date } : null,
    };
  }

  @Get('custom-foods')
  async listCustomFoods(@Request() req: any) {
    const userId = this.resolveUserId(req);
    const items = await this.userCustomFoodService.list(userId);
    return { count: items.length, items };
  }

  @Get('custom-foods/:id')
  async getCustomFood(@Request() req: any, @Param('id') id: string) {
    const userId = this.resolveUserId(req);
    return this.userCustomFoodService.findOne(userId, id);
  }

  @Post('custom-foods')
  async createCustomFood(
    @Request() req: any,
    @Body() dto: CreateCustomFoodDto,
  ) {
    const userId = this.resolveUserId(req);
    return this.userCustomFoodService.create(userId, dto);
  }

  @Patch('custom-foods/:id')
  async updateCustomFood(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateCustomFoodDto,
  ) {
    const userId = this.resolveUserId(req);
    return this.userCustomFoodService.update(userId, id, dto);
  }

  @Delete('custom-foods/:id')
  @HttpCode(HttpStatus.OK)
  async deleteCustomFood(@Request() req: any, @Param('id') id: string) {
    const userId = this.resolveUserId(req);
    return this.userCustomFoodService.softDelete(userId, id);
  }

 
  @Post('log')
  async logEntry(@Request() req: any, @Body() dto: CreateLogEntryDto) {
    const userId = this.resolveUserId(req);
    return this.nutritionService.logEntry(userId, dto);
  }


  @Get('daily')
  async getDaily(@Request() req: any, @Query() query: DailyQueryDto) {
    const userId = this.resolveUserId(req);
    const daily = await this.nutritionService.getDaily(userId, query.date);
    if (!daily) {
      const date = query.date ?? await this.nutritionService.getUserLocalDate(userId);
      const targets = await this.nutritionService.getActiveTargets(userId);
      return {
        date,
        entries: [],
        totals: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
        targets,
        waterIntake: { total_ml: 0, entries: [] },
      };
    }
    return daily;
  }

  @Get('daily-history')
  async getDailyHistory(
    @Request() req: any,
    @Query('month') month: string,
  ) {
    const userId = this.resolveUserId(req);
    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new BadRequestException('month query param required in YYYY-MM format (01-12)');
    }
    const days = await this.nutritionService.getDailyHistory(userId, month);
    return { days };
  }


  @Patch('log/:entryId')
  async updateEntry(
    @Request() req: any,
    @Param('entryId') entryId: string,
    @Body() dto: UpdateLogEntryDto,
  ) {
    const userId = this.resolveUserId(req);
    if (!isValidObjectId(entryId)) {
      throw new BadRequestException('Invalid entry id');
    }
    return this.nutritionService.updateEntry(userId, entryId, dto);
  }


  @Delete('log/:entryId')
  @HttpCode(HttpStatus.OK)
  async deleteEntry(
    @Request() req: any,
    @Param('entryId') entryId: string,
  ) {
    const userId = this.resolveUserId(req);
    if (!isValidObjectId(entryId)) {
      throw new BadRequestException('Invalid entry id');
    }
    return this.nutritionService.deleteEntry(userId, entryId);
  }

  @Post('ai-estimate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async aiEstimate(@Request() req: any, @Body() dto: AiEstimateDto) {
    const userId = this.resolveUserId(req);
    const country = await this.resolveUserCountry(userId);
    return this.nutritionAi.estimateNutrition(
      dto.foodDescription,
      dto.servingLabel,
      dto.servingGrams,
      country,
    );
  }

  /* ─── Recipe Nutrition ────────────────────────────────── */

  @Get('recipes/search')
  async searchRecipes(
    @Request() req: any,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('country') country?: string,
  ) {
    this.resolveUserId(req);
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    const safeLimit = Number.isFinite(parsedLimit) ? parsedLimit : 20;
    const recipes = await this.recipeNutrition.searchRecipes(
      q ?? '',
      safeLimit,
      country,
    );
    return { items: recipes };
  }

  @Get('recipes/:id/nutrition')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async getRecipeNutrition(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    this.resolveUserId(req);
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid recipe id');
    }
    return this.recipeNutrition.getOrCompute(id);
  }

  /* ─── Health Profile ────────────────────────────────── */

  @Get('health-profile')
  async getHealthProfile(@Request() req: any) {
    const userId = this.resolveUserId(req);
    const profile = await this.healthProfileService.getProfile(userId);
    return { profile };
  }

  @Post('health-profile')
  async createHealthProfile(
    @Request() req: any,
    @Body() dto: CreateHealthProfileDto,
  ) {
    const userId = this.resolveUserId(req);
    const profile = await this.healthProfileService.createProfile(userId, dto);
    return { profile };
  }

  @Patch('health-profile/weight')
  async updateWeight(@Request() req: any, @Body() dto: UpdateWeightDto) {
    const userId = this.resolveUserId(req);
    const profile = await this.healthProfileService.updateWeight(userId, dto);
    return { profile };
  }

  @Post('health-profile/water')
  @HttpCode(HttpStatus.OK)
  async logWater(@Request() req: any, @Body() dto: LogWaterDto) {
    const userId = this.resolveUserId(req);
    return this.healthProfileService.logWater(userId, dto);
  }

  @Get('health-profile/insights')
  async getMonthlyInsights(@Request() req: any) {
    const userId = this.resolveUserId(req);
    const snapshots = await this.healthProfileService.getMonthlyInsights(userId);
    return { snapshots };
  }

  @Post('health-profile/insights/generate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async generateMonthlySnapshot(@Request() req: any) {
    const userId = this.resolveUserId(req);
    const snapshot = await this.healthProfileService.generateMonthlySnapshot(userId);
    return { snapshot };
  }

  @Get('health-profile/daily-recommendation')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async getDailyRecommendation(@Request() req: any) {
    const userId = this.resolveUserId(req);
    return this.healthProfileService.getDailyRecommendation(userId);
  }

  /* ─── Edit & Reset ──────────────────────────────────── */

  @Patch('health-profile')
  async updateHealthProfile(
    @Request() req: any,
    @Body() dto: UpdateHealthProfileDto,
  ) {
    const userId = this.resolveUserId(req);
    const profile = await this.healthProfileService.updateProfile(userId, dto);
    return { profile };
  }

  @Delete('daily/:date/entries')
  @HttpCode(HttpStatus.OK)
  async resetDayEntries(
    @Request() req: any,
    @Param('date') date: string,
  ) {
    const userId = this.resolveUserId(req);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }
    const daily = await this.healthProfileService.resetDayEntries(userId, date);
    return { daily: daily ?? { date, entries: [], totals: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 } } };
  }

  @Delete('daily/:date/recommendation')
  @HttpCode(HttpStatus.OK)
  async resetDailyRecommendation(
    @Request() req: any,
    @Param('date') date: string,
  ) {
    const userId = this.resolveUserId(req);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }
    return this.healthProfileService.resetDailyRecommendation(userId, date);
  }

  @Patch('daily/:date/targets')
  async updateDailyTargets(
    @Request() req: any,
    @Param('date') date: string,
    @Body() dto: UpdateDailyTargetsDto,
  ) {
    const userId = this.resolveUserId(req);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }
    const daily = await this.healthProfileService.updateDailyTargets(userId, date, dto);
    return { daily };
  }

  @Delete('daily/:date/water')
  @HttpCode(HttpStatus.OK)
  async resetWaterIntake(
    @Request() req: any,
    @Param('date') date: string,
  ) {
    const userId = this.resolveUserId(req);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }
    return this.healthProfileService.resetWaterIntake(userId, date);
  }

  @Delete('daily/:date/water/:index')
  @HttpCode(HttpStatus.OK)
  async deleteWaterEntry(
    @Request() req: any,
    @Param('date') date: string,
    @Param('index') index: string,
  ) {
    const userId = this.resolveUserId(req);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }
    const idx = parseInt(index, 10);
    if (!Number.isFinite(idx) || idx < 0) {
      throw new BadRequestException('index must be a non-negative integer');
    }
    return this.healthProfileService.deleteWaterEntry(userId, date, idx);
  }

  @Post('health-profile/insights/reset/:month')
  @HttpCode(HttpStatus.OK)
  async resetMonthlySnapshot(
    @Request() req: any,
    @Param('month') month: string,
  ) {
    const userId = this.resolveUserId(req);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new BadRequestException('month must be YYYY-MM format');
    }
    const snapshot = await this.healthProfileService.resetMonthlySnapshotForMonth(userId, month);
    return { snapshot };
  }

  @Post('health-profile/insights/reset')
  @HttpCode(HttpStatus.OK)
  async resetAllSnapshots(@Request() req: any) {
    const userId = this.resolveUserId(req);
    const snapshots = await this.healthProfileService.resetAllSnapshots(userId);
    return { snapshots };
  }
}
