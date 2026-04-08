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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { FoodItemService } from './food-item.service';
import { UserCustomFoodService } from './user-custom-food.service';
import { NutritionService } from './nutrition.service';
import { OpenFoodFactsProvider } from './providers/open-food-facts.provider';
import { HydraSearchService } from './hydra-search.service';
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
import { NutritionAiService } from './nutrition-ai.service';
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
  ) {}

  private resolveUserId(req: any): string {
    const u = req?.user ?? {};
    const id = u._id ?? u.userId ?? u.id ?? u.sub;
    if (!id) throw new UnauthorizedException();
    return String(id);
  }


  @Get('foods/search')
  async searchFoods(@Query() query: FoodSearchQueryDto) {
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
    const cached = await this.foodItemService.findByBarcode(dto.barcode);
    if (cached) {
      return { source: 'cache', item: cached };
    }

    this.logger.log(`Barcode ${dto.barcode} not cached, fetching from OFF`);
    const fetched = await this.openFoodFacts.fetchByBarcode(dto.barcode);
    if (!fetched) {
      throw new NotFoundException(
        'No product found for this barcode in OpenFoodFacts',
      );
    }

    const saved = await this.foodItemService.upsert(fetched);
    return { source: 'openfoodfacts', item: saved };
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
      return {
        date: query.date ?? new Date().toISOString().slice(0, 10),
        entries: [],
        totals: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
        targets: null,
      };
    }
    return daily;
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
  async aiEstimate(@Body() dto: AiEstimateDto) {
    return this.nutritionAi.estimateNutrition(
      dto.foodDescription,
      dto.servingLabel,
      dto.servingGrams,
    );
  }
}
