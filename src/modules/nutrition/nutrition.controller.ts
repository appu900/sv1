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
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  RequireFeature,
  SubscriptionGuard,
} from '../subscription/subscription.guard';
import { SubscriptionService } from '../subscription/subscription.service';
import { ApiSubscription } from '../../common/swagger/api-auth.decorators';
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


@ApiTags('Nutrition')
@ApiSubscription()
@Controller('nutrition')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
@RequireFeature('nutrition_insights')
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
    private readonly subscriptionService: SubscriptionService,
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
  @ApiOperation({
    summary: 'Search the food catalog',
    description:
      'Hydra search across catalog foods. Query `q` (max 120 chars), optional `locale` (or the user’s country), `limit` (1–50, default 20), and `verifiedOnly`. Requires an active subscription with `nutrition_insights`.',
  })
  @ApiQuery({ name: 'q', required: false, description: 'Search text (max 120 chars).' })
  @ApiQuery({ name: 'locale', required: false, description: 'Country/locale code, or `global`.' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max results (1–50). Defaults to 20.' })
  @ApiQuery({ name: 'verifiedOnly', required: false, description: 'If true, only verified catalog foods.' })
  @ApiOkResponse({ description: 'Matching food items.' })
  async searchFoods(@Request() req: any, @Query() query: FoodSearchQueryDto) {
    const userId = this.resolveUserId(req); // ensure authenticated user
    const country = await this.resolveUserCountry(userId);
    return this.hydraSearch.search(query.q ?? '', {
      limit: query.limit ?? 20,
      locale: query.locale ?? country,
    });
  }

 
  @Get('foods/:id')
  @ApiOperation({
    summary: 'Get a catalog food by id',
    description:
      'Returns one catalog food item by Mongo ObjectId, including per-serving nutrition facts.',
  })
  @ApiParam({ name: 'id', description: 'Food item ObjectId.' })
  @ApiOkResponse({ description: 'Food item document.' })
  async getFood(@Param('id') id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid food id');
    }
    return this.foodItemService.findById(id);
  }

 
  @Post('foods/barcode')
  @HttpCode(HttpStatus.OK)
  @RequireFeature('barcode_scanning')
  @ApiOperation({
    summary: 'Look up a food by barcode',
    description:
      'Looks up a packaged product by barcode (6–14 digits) using country-aware sources. Requires the `barcode_scanning` feature and consumes one kitchen-scan slot (refunded if the lookup fails). Returns 404 when no product is found.',
  })
  @ApiBody({ type: BarcodeLookupDto })
  @ApiOkResponse({ description: 'Matched product from catalog or Open Food Facts.' })
  async lookupBarcode(@Request() req: any, @Body() dto: BarcodeLookupDto) {
    const userId = this.resolveUserId(req);
    const country = await this.resolveUserCountry(userId);

    let usageReserved = false;
    try {
      await this.subscriptionService.incrementUsage(userId, 'kitchenScansUsed');
      usageReserved = true;

      const result = await this.barcodeLookup.lookupForCountry(
        dto.barcode,
        country,
      );
      if (!result) {
        this.logger.warn(`Barcode ${dto.barcode} not found in any data source`);
        throw new NotFoundException(
          `No product found for barcode ${dto.barcode}`,
        );
      }
      return result;
    } catch (error) {
      if (usageReserved) {
        await this.subscriptionService
          .refundUsage(userId, 'kitchenScansUsed')
          .catch((refundError) => {
            this.logger.warn(
              `Failed to refund barcode scan usage for user ${userId}: ${(refundError as Error)?.message}`,
            );
          });
      }
      throw error;
    }
  }

  @Post('foods/analyze-image')
  @HttpCode(HttpStatus.OK)
  @RequireFeature('barcode_scanning')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'image', maxCount: 1 },      
        { name: 'barcode', maxCount: 1 },      
        { name: 'nutrition', maxCount: 1 },    
        { name: 'front', maxCount: 1 },        
      ],
      {
        limits: { fileSize: 10 * 1024 * 1024 }, 
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
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Analyze product photos (barcode / label / front)',
    description:
      'Multipart AI product scan. Send any combination of `barcode`, `nutrition`, and `front` images, or a legacy single `image`. Each file max 10 MB. Rate-limited to **5 requests per 60 seconds**. Requires `barcode_scanning`. Returns an existing catalog match when the barcode/name is known, otherwise creates a catalog item from the AI analysis.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'Legacy single product photo (used when barcode/nutrition/front are omitted).',
        },
        barcode: {
          type: 'string',
          format: 'binary',
          description: 'Photo of the barcode.',
        },
        nutrition: {
          type: 'string',
          format: 'binary',
          description: 'Photo of the nutrition-facts panel.',
        },
        front: {
          type: 'string',
          format: 'binary',
          description: 'Photo of the front of pack.',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Matched or newly created product.' })
  async analyzeProductImage(
    @Request() req: any,
    @UploadedFiles() files: { image?: Express.Multer.File[]; barcode?: Express.Multer.File[]; nutrition?: Express.Multer.File[]; front?: Express.Multer.File[] },
  ) {
    const userId = this.resolveUserId(req);
    const country = await this.resolveUserCountry(userId);

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
      const existing = await this.barcodeLookup.lookupForCountry(analysis.barcode, country);
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
  @RequireFeature('barcode_scanning')
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
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Identify food in a photo and search the catalog',
    description:
      'Multipart. Field `image` is a plate / food photo (max 10 MB). Rate-limited to **10 requests per 60 seconds**. Requires `barcode_scanning`. AI names the food, then Hydra searches the catalog. Optional `limit` (1–50, default 20) and `locale`.',
  })
  @ApiQuery({ name: 'limit', required: false, description: 'Max catalog hits (1–50). Defaults to 20.' })
  @ApiQuery({ name: 'locale', required: false, description: 'Override locale; defaults to the user’s country.' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'Photo of the food / plate.',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Identified food name plus catalog search results.' })
  async identifyFoodFromImage(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Query('limit') limit?: string,
    @Query('locale') locale?: string,
  ) {
    const userId = this.resolveUserId(req);

    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Image file is required');
    }

    const country = await this.resolveUserCountry(userId);
    const base64 = file.buffer.toString('base64');
    const identified = await this.nutritionAi.identifyFoodFromImage(
      base64,
      file.mimetype,
      country,
    );

    if (!identified.primaryFood) {
      throw new NotFoundException('Could not identify any food in the image');
    }

    // Search hydra with the identified primary food name
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    const safeLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 20;

    const searchResults = await this.hydraSearch.search(
      identified.primaryFood,
      { limit: safeLimit, locale: locale ?? country ?? undefined },
    );

    return {
      identified,
      searchResults,
    };
  }

  /* ─── Photo Quick-Add ──────────────────────────────── */

  @Post('foods/photo-quick-add')
  @HttpCode(HttpStatus.OK)
  @RequireFeature('barcode_scanning')
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
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Photo quick-add: estimate nutrition and save a custom food',
    description:
      'Multipart. Field `image` is required (max 10 MB). Optional form fields: `description`, `servingLabel`, `servingGrams`, `mealSlot`, `date` (YYYY-MM-DD), `autoLog`. Rate-limited to **5 requests per 60 seconds**. Requires `barcode_scanning`. AI estimates full nutrition, saves a user custom food, and optionally logs it to daily intake when `autoLog` is true.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'Photo of the meal or food.',
        },
        description: { type: 'string', description: 'Optional hint, e.g. "dal chawal with papad".' },
        servingLabel: { type: 'string', description: 'Optional serving label, e.g. "1 large plate".' },
        servingGrams: { type: 'number', description: 'Optional estimated weight in grams (1–5000).' },
        mealSlot: { type: 'string', description: 'Meal slot used when autoLog is true.' },
        date: { type: 'string', description: 'Log date YYYY-MM-DD when autoLog is true.' },
        autoLog: { type: 'boolean', description: 'If true, also write a daily-intake entry.' },
      },
    },
  })
  @ApiOkResponse({ description: 'Analysis, saved custom food, and optional log entry.' })
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

    let imageUrl: string | null = null;
    try {
      imageUrl = await this.imageUpload.uploadFile(file, 'photo-food');
    } catch (err) {
      this.logger.warn(`Failed to upload food photo: ${(err as Error).message}`);
    }

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
  @ApiOperation({
    summary: 'List the user’s custom foods',
    description:
      'Returns every custom food the subscriber has created (including photo-quick-add items).',
  })
  @ApiOkResponse({ description: '{ count, items } of custom foods.' })
  async listCustomFoods(@Request() req: any) {
    const userId = this.resolveUserId(req);
    const items = await this.userCustomFoodService.list(userId);
    return { count: items.length, items };
  }

  @Get('custom-foods/:id')
  @ApiOperation({
    summary: 'Get one custom food',
    description:
      'Returns a custom food owned by the subscriber.',
  })
  @ApiParam({ name: 'id', description: 'Custom food ObjectId.' })
  @ApiOkResponse({ description: 'Custom food document.' })
  async getCustomFood(@Request() req: any, @Param('id') id: string) {
    const userId = this.resolveUserId(req);
    return this.userCustomFoodService.findOne(userId, id);
  }

  @Post('custom-foods')
  @ApiOperation({
    summary: 'Create a custom food',
    description:
      'Manually creates a custom food with name, serving, and per-serving nutrition facts.',
  })
  @ApiBody({ type: CreateCustomFoodDto })
  @ApiCreatedResponse({ description: 'Custom food created.' })
  async createCustomFood(
    @Request() req: any,
    @Body() dto: CreateCustomFoodDto,
  ) {
    const userId = this.resolveUserId(req);
    return this.userCustomFoodService.create(userId, dto);
  }

  @Patch('custom-foods/:id')
  @ApiOperation({
    summary: 'Update a custom food',
    description:
      'Partial update of a custom food owned by the subscriber.',
  })
  @ApiParam({ name: 'id', description: 'Custom food ObjectId.' })
  @ApiBody({ type: UpdateCustomFoodDto })
  @ApiOkResponse({ description: 'Updated custom food.' })
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
  @ApiOperation({
    summary: 'Soft-delete a custom food',
    description:
      'Soft-deletes a custom food owned by the subscriber. Existing log entries that reference it are kept.',
  })
  @ApiParam({ name: 'id', description: 'Custom food ObjectId.' })
  @ApiOkResponse({ description: 'Custom food soft-deleted.' })
  async deleteCustomFood(@Request() req: any, @Param('id') id: string) {
    const userId = this.resolveUserId(req);
    return this.userCustomFoodService.softDelete(userId, id);
  }

 
  @Post('log')
  @ApiOperation({
    summary: 'Log a food to daily intake',
    description:
      'Adds an entry to the daily diary. `ref.kind` is food | custom | recipe | user_recipe | freeform. `portion.mode` is serving | count | grams | ml. Optional `mealSlot` and `date` (YYYY-MM-DD, defaults to the user’s local today).',
  })
  @ApiBody({ type: CreateLogEntryDto })
  @ApiCreatedResponse({ description: 'Log entry created.' })
  async logEntry(@Request() req: any, @Body() dto: CreateLogEntryDto) {
    const userId = this.resolveUserId(req);
    return this.nutritionService.logEntry(userId, dto);
  }


  @Get('daily')
  @ApiOperation({
    summary: 'Get a daily intake diary',
    description:
      'Returns entries, totals, targets, and water intake for `date` (YYYY-MM-DD). Omitting `date` uses the user’s local today. An empty structured diary is returned when nothing has been logged.',
  })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD. Defaults to the user’s local today.' })
  @ApiOkResponse({ description: 'Daily diary (or an empty structured day).' })
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
  @ApiOperation({
    summary: 'Get a month of daily diaries',
    description:
      'Returns a compact day-by-day history for calendar / streak views. `month` is required and must be `YYYY-MM`.',
  })
  @ApiQuery({ name: 'month', required: true, description: 'Month in YYYY-MM format (01–12).' })
  @ApiOkResponse({ description: '{ days } for that month.' })
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

  @Get('streak')
  @ApiOperation({
    summary: 'Get the logging streak',
    description:
      'Returns the subscriber’s current and longest daily-logging streaks.',
  })
  @ApiOkResponse({ description: 'Logging streak payload.' })
  async getLoggingStreak(@Request() req: any) {
    const userId = this.resolveUserId(req);
    return this.nutritionService.getLoggingStreak(userId);
  }


  @Patch('log/:entryId')
  @ApiOperation({
    summary: 'Update a log entry',
    description:
      'Partial update of portion, meal slot, ref, or freeform facts on a daily-intake entry owned by the subscriber.',
  })
  @ApiParam({ name: 'entryId', description: 'Log entry ObjectId.' })
  @ApiBody({ type: UpdateLogEntryDto })
  @ApiOkResponse({ description: 'Updated log entry / daily totals.' })
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
  @ApiOperation({
    summary: 'Delete a log entry',
    description:
      'Removes a daily-intake entry and recalculates that day’s totals.',
  })
  @ApiParam({ name: 'entryId', description: 'Log entry ObjectId.' })
  @ApiOkResponse({ description: 'Entry deleted and totals recalculated.' })
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
  @ApiOperation({
    summary: 'AI-estimate nutrition from a food description',
    description:
      'Estimates macros from a free-text `foodDescription` plus optional `servingLabel` / `servingGrams`. Rate-limited to **10 requests per 60 seconds**. Used when the user types a food that is not in the catalog.',
  })
  @ApiBody({ type: AiEstimateDto })
  @ApiOkResponse({ description: 'Estimated nutrition facts.' })
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
  @ApiOperation({
    summary: 'Search recipes for nutrition logging',
    description:
      'Finds cookbook recipes that can be logged as a meal. Query `q`, optional `limit` (default 20), and `country`.',
  })
  @ApiQuery({ name: 'q', required: false, description: 'Recipe search text.' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max results. Defaults to 20.' })
  @ApiQuery({ name: 'country', required: false, description: 'ISO country code to scope the catalog.' })
  @ApiOkResponse({ description: '{ items } of matching recipes.' })
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
  @ApiOperation({
    summary: 'Get or compute recipe nutrition',
    description:
      'Returns cached per-serving nutrition for a recipe, computing it from ingredients when missing. Rate-limited to **5 requests per 60 seconds**.',
  })
  @ApiParam({ name: 'id', description: 'Recipe ObjectId.' })
  @ApiOkResponse({ description: 'Recipe nutrition facts.' })
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
  @ApiOperation({
    summary: 'Get the health profile',
    description:
      'Returns the subscriber’s health profile (sex, age, height, weight, activity, goals) or null when not created yet.',
  })
  @ApiOkResponse({ description: '{ profile }' })
  async getHealthProfile(@Request() req: any) {
    const userId = this.resolveUserId(req);
    const profile = await this.healthProfileService.getProfile(userId);
    return { profile };
  }

  @Post('health-profile')
  @ApiOperation({
    summary: 'Create a health profile',
    description:
      'Creates the subscriber’s health profile and computes initial daily calorie / macro targets.',
  })
  @ApiBody({ type: CreateHealthProfileDto })
  @ApiCreatedResponse({ description: '{ profile }' })
  async createHealthProfile(
    @Request() req: any,
    @Body() dto: CreateHealthProfileDto,
  ) {
    const userId = this.resolveUserId(req);
    const profile = await this.healthProfileService.createProfile(userId, dto);
    return { profile };
  }

  @Patch('health-profile/weight')
  @ApiOperation({
    summary: 'Update weight on the health profile',
    description:
      'Logs a new weight reading and may recalculate daily targets.',
  })
  @ApiBody({ type: UpdateWeightDto })
  @ApiOkResponse({ description: '{ profile }' })
  async updateWeight(@Request() req: any, @Body() dto: UpdateWeightDto) {
    const userId = this.resolveUserId(req);
    const profile = await this.healthProfileService.updateWeight(userId, dto);
    return { profile };
  }

  @Post('health-profile/water')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log a water intake entry',
    description:
      'Adds a water amount (ml) to the daily diary for today or a supplied date.',
  })
  @ApiBody({ type: LogWaterDto })
  @ApiOkResponse({ description: 'Updated water intake for the day.' })
  async logWater(@Request() req: any, @Body() dto: LogWaterDto) {
    const userId = this.resolveUserId(req);
    return this.healthProfileService.logWater(userId, dto);
  }

  @Get('health-profile/insights')
  @ApiOperation({
    summary: 'List monthly nutrition insight snapshots',
    description:
      'Returns previously generated monthly insight snapshots for the subscriber.',
  })
  @ApiOkResponse({ description: '{ snapshots }' })
  async getMonthlyInsights(@Request() req: any) {
    const userId = this.resolveUserId(req);
    const snapshots = await this.healthProfileService.getMonthlyInsights(userId);
    return { snapshots };
  }

  @Post('health-profile/insights/generate')
  @HttpCode(HttpStatus.OK)
  @RequireFeature('nutrition_coaching')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Generate this month’s insight snapshot',
    description:
      'AI coaching snapshot for the current month from logged intake and the health profile. Requires `nutrition_coaching`. Rate-limited to **5 requests per 60 seconds**.',
  })
  @ApiOkResponse({ description: '{ snapshot }' })
  async generateMonthlySnapshot(@Request() req: any) {
    const userId = this.resolveUserId(req);
    const snapshot = await this.healthProfileService.generateMonthlySnapshot(userId);
    return { snapshot };
  }

  @Get('health-profile/daily-recommendation')
  @RequireFeature('nutrition_coaching')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Get today’s nutrition recommendation',
    description:
      'AI daily coaching tip based on remaining targets and recent logs. Requires `nutrition_coaching`. Rate-limited to **10 requests per 60 seconds**.',
  })
  @ApiOkResponse({ description: 'Daily recommendation payload.' })
  async getDailyRecommendation(@Request() req: any) {
    const userId = this.resolveUserId(req);
    return this.healthProfileService.getDailyRecommendation(userId);
  }

  /* ─── Edit & Reset ──────────────────────────────────── */

  @Patch('health-profile')
  @ApiOperation({
    summary: 'Update the health profile',
    description:
      'Partial update of goals, activity, height, etc. May recalculate daily targets.',
  })
  @ApiBody({ type: UpdateHealthProfileDto })
  @ApiOkResponse({ description: '{ profile }' })
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
  @ApiOperation({
    summary: 'Reset all food entries for a day',
    description:
      'Deletes every food log entry for `date` (YYYY-MM-DD). Water and targets are left in place.',
  })
  @ApiParam({ name: 'date', description: 'Day to reset, YYYY-MM-DD.' })
  @ApiOkResponse({ description: 'Day with empty entries / zeroed food totals.' })
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
  @ApiOperation({
    summary: 'Clear the daily recommendation for a day',
    description:
      'Removes the cached AI daily recommendation for `date` (YYYY-MM-DD) so it can be regenerated.',
  })
  @ApiParam({ name: 'date', description: 'Day, YYYY-MM-DD.' })
  @ApiOkResponse({ description: 'Recommendation cleared.' })
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
  @ApiOperation({
    summary: 'Override daily nutrition targets',
    description:
      'Sets calorie / macro targets for a specific `date` (YYYY-MM-DD) without changing the long-lived health-profile defaults.',
  })
  @ApiParam({ name: 'date', description: 'Day, YYYY-MM-DD.' })
  @ApiBody({ type: UpdateDailyTargetsDto })
  @ApiOkResponse({ description: '{ daily } with updated targets.' })
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
  @ApiOperation({
    summary: 'Reset all water intake for a day',
    description:
      'Clears every water entry for `date` (YYYY-MM-DD).',
  })
  @ApiParam({ name: 'date', description: 'Day, YYYY-MM-DD.' })
  @ApiOkResponse({ description: 'Water intake reset.' })
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
  @ApiOperation({
    summary: 'Delete one water entry',
    description:
      'Removes a single water log at zero-based `index` for `date` (YYYY-MM-DD).',
  })
  @ApiParam({ name: 'date', description: 'Day, YYYY-MM-DD.' })
  @ApiParam({ name: 'index', description: 'Zero-based index of the water entry.' })
  @ApiOkResponse({ description: 'Water entry removed.' })
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
  @ApiOperation({
    summary: 'Reset one monthly insight snapshot',
    description:
      'Deletes and returns a cleared snapshot for `month` (YYYY-MM) so it can be regenerated.',
  })
  @ApiParam({ name: 'month', description: 'Month in YYYY-MM format.' })
  @ApiOkResponse({ description: '{ snapshot } after reset.' })
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
  @ApiOperation({
    summary: 'Reset all monthly insight snapshots',
    description:
      'Clears every stored monthly insight snapshot for the subscriber.',
  })
  @ApiOkResponse({ description: '{ snapshots } after reset.' })
  async resetAllSnapshots(@Request() req: any) {
    const userId = this.resolveUserId(req);
    const snapshots = await this.healthProfileService.resetAllSnapshots(userId);
    return { snapshots };
  }
}
