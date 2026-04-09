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
  UseGuards,
} from '@nestjs/common';
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
import {
  CreateHealthProfileDto,
  UpdateWeightDto,
  LogWaterDto,
} from './dto/health-profile.dto';
import { NutritionAiService } from './nutrition-ai.service';
import { HealthProfileService } from './health-profile.service';
import { isValidObjectId } from 'mongoose';


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
    private readonly healthProfileService: HealthProfileService,
    private readonly barcodeLookup: BarcodeLookupService,
  ) {}

  private resolveUserId(req: any): string {
    const u = req?.user ?? {};
    const id = u._id ?? u.userId ?? u.id ?? u.sub;
    if (!id) throw new UnauthorizedException();
    return String(id);
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
    this.resolveUserId(req);
    return this.nutritionAi.estimateNutrition(
      dto.foodDescription,
      dto.servingLabel,
      dto.servingGrams,
    );
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
}
