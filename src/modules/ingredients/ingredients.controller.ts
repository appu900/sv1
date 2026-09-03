import {
  Controller,
  Body,
  Get,
  Put,
  Delete,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Param,
  Patch,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
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
import { sendCacheableJson } from 'src/common/http/cacheable-json';
import { DataVersionService } from '../data-version/data-version.service';
import { IngredientsService } from './ingredients.service';
import { CreateCatgoryDto } from './dto/ingrediants.category.dto';
import { CreateIngredientDto } from './dto/create-ingredient.dto';
import { UpdateIngredientDto } from './dto/update-ingredient.dto';
import { Roles } from 'src/common/decorators/role.decorators';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiJwtRoles } from 'src/common/swagger/api-auth.decorators';

const INGREDIENT_MULTIPART_PROPERTIES = {
  name: { type: 'string', description: 'Ingredient display name.' },
  averageWeight: { type: 'string', description: 'Average weight in grams.' },
  categoryId: { type: 'string', description: 'Ingredient category ObjectId.' },
  suitableDiets: {
    type: 'string',
    description: 'JSON array of diet category ObjectIds.',
  },
  hasPage: { type: 'string', description: '`true`/`false` — whether this ingredient has a detail page.' },
  theme: { type: 'string', description: 'Ingredient theme enum when `hasPage` is true.' },
  parentIngredients: {
    type: 'string',
    description: 'JSON array of parent ingredient ObjectIds.',
  },
  description: { type: 'string', description: 'Long-form ingredient description.' },
  foodFactId: { type: 'string', description: 'Related food-fact ObjectId.' },
  relatedHacks: {
    type: 'string',
    description: 'JSON array of related hack ObjectIds.',
  },
  inSeason: { type: 'string', description: 'JSON array of month names.' },
  seasonByCountry: {
    type: 'string',
    description: 'JSON object mapping country code to month arrays.',
  },
  stickerId: { type: 'string', description: 'Optional sticker ObjectId.' },
  isPantryItem: { type: 'string', description: '`true`/`false`.' },
  nutrition: { type: 'string', description: 'Nutrition notes / payload.' },
  order: { type: 'string', description: 'Display order (number).' },
  countries: {
    type: 'string',
    description: 'JSON array of country codes this ingredient is available in.',
  },
  heroImage: {
    type: 'string',
    format: 'binary',
    description: 'Ingredient hero image file.',
  },
};

@ApiTags('Ingredients')
@Controller('ingredients')
export class IngredientsController {
  constructor(
    private readonly ingrediantsService: IngredientsService,
    private readonly dataVersionService: DataVersionService,
  ) {}

  // Category endpoints
  @Post('category')
  @Roles('ADMIN', 'CHEF')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'image', maxCount: 1 }]))
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Create an ingredient category',
    description:
      'Creates an ingredient category with a name and optional image. Requires admin or chef.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Category display name.' },
        image: {
          type: 'string',
          format: 'binary',
          description: 'Category image file.',
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Ingredient category created.' })
  async createCategory(
    @Body() dto: CreateCatgoryDto,
    @UploadedFiles() files: { image: Express.Multer.File[] },
  ) {
    return this.ingrediantsService.create(dto, files);
  }

  @Get('category')
  @ApiOperation({
    summary: 'List ingredient categories',
    description: 'Returns all ingredient categories. Public; no auth required.',
  })
  @ApiOkResponse({ description: 'Array of ingredient categories.' })
  async fetchCategory() {
    return this.ingrediantsService.getAllCategories();
  }

  @Patch('category/:id')
  @Roles('ADMIN', 'CHEF')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'image', maxCount: 1 }]))
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Update an ingredient category',
    description:
      'Updates a category name and/or image. Requires admin or chef.',
  })
  @ApiParam({ name: 'id', description: 'Ingredient category ObjectId.' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Category display name.' },
        image: {
          type: 'string',
          format: 'binary',
          description: 'Replacement category image file.',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Updated ingredient category.' })
  async updateCategory(
    @Param('id') id: string,
    @Body() dto: CreateCatgoryDto,
    @UploadedFiles() files: { image?: Express.Multer.File[] },
  ) {
    return this.ingrediantsService.updateCategory(id, dto, files);
  }

  @Delete('category/:id')
  @Roles('ADMIN', 'CHEF')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiOperation({
    summary: 'Delete an ingredient category',
    description: 'Deletes an ingredient category by id. Requires admin or chef.',
  })
  @ApiParam({ name: 'id', description: 'Ingredient category ObjectId.' })
  @ApiOkResponse({ description: 'Ingredient category deleted.' })
  async deleteCategory(@Param('id') id: string) {
    return this.ingrediantsService.deleteCategory(id);
  }

  // Ingredient endpoints
  @Post()
  @Roles('ADMIN', 'CHEF')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'heroImage', maxCount: 1 }]),
  )
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Create an ingredient',
    description:
      'Creates an ingredient with nutrition/season metadata and an optional hero image. Array/object fields (`suitableDiets`, `parentIngredients`, `relatedHacks`, `inSeason`, `seasonByCountry`, `countries`) may be sent as JSON strings. Requires admin or chef.',
  })
  @ApiBody({
    schema: { type: 'object', properties: INGREDIENT_MULTIPART_PROPERTIES },
  })
  @ApiCreatedResponse({ description: 'Ingredient created.' })
  async createIngredient(
    @Body() dto: CreateIngredientDto,
    @UploadedFiles() files: { heroImage?: Express.Multer.File[] },
  ) {
    return this.ingrediantsService.createIngredient(dto, files);
  }

  @Get()
  @ApiOperation({
    summary: 'List ingredients',
    description:
      'Returns the full ingredient catalogue. Optionally filter by country code.',
  })
  @ApiQuery({
    name: 'country',
    required: false,
    description: 'ISO country code to filter ingredients (e.g. AU, IN).',
  })
  @ApiOkResponse({ description: 'Array of ingredients.' })
  async getAllIngredients(@Query('country') country?: string) {
    return this.ingrediantsService.getAllIngredients(country);
  }

  @Get('summaries')
  @ApiOperation({
    summary: 'List ingredient summaries',
    description:
      'Lightweight ingredient cards for list UIs. Supports a data-version pin via `v` and returns `ETag` / `X-Data-Version` for client cache invalidation.',
  })
  @ApiQuery({
    name: 'country',
    required: false,
    description: 'ISO country code to filter summaries (e.g. AU, IN).',
  })
  @ApiQuery({
    name: 'v',
    required: false,
    description:
      'Client data-version pin for the ingredients collection. When it matches the current version the response is cacheable as immutable; otherwise caches must revalidate.',
  })
  @ApiOkResponse({ description: 'Array of ingredient summaries.' })
  async getIngredientSummaries(
    @Req() req: Request,
    @Res() res: Response,
    @Query('country') country?: string,
    @Query('v') v?: string,
  ) {
    const [data, currentVersion] = await Promise.all([
      this.ingrediantsService.getIngredientSummaries(country),
      this.dataVersionService.getVersion('ingredients'),
    ]);
    return sendCacheableJson(req, res, data, {
      requestedVersion: v,
      currentVersion,
    });
  }

  @Get('batch')
  @ApiOperation({
    summary: 'Get ingredients by ids',
    description:
      'Fetches multiple ingredients in one request. Pass a comma-separated list of ObjectIds. Returns an empty array when `ids` is omitted.',
  })
  @ApiQuery({
    name: 'ids',
    required: false,
    description: 'Comma-separated ingredient ObjectIds (e.g. `id1,id2,id3`).',
  })
  @ApiOkResponse({ description: 'Array of matching ingredients.' })
  async getIngredientsByIds(@Query('ids') ids: string) {
    if (!ids) return [];
    const idArray = ids.split(',').map(id => id.trim()).filter(Boolean);
    return this.ingrediantsService.getIngredientsByIds(idArray);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get ingredient by id',
    description: 'Returns a single ingredient by Mongo ObjectId.',
  })
  @ApiParam({ name: 'id', description: 'Ingredient ObjectId.' })
  @ApiOkResponse({ description: 'Ingredient document.' })
  async getIngredientById(@Param('id') id: string) {
    return this.ingrediantsService.getIngredientById(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'CHEF')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'heroImage', maxCount: 1 }]),
  )
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Update an ingredient',
    description:
      'Partial update of an ingredient. Optional new `heroImage` replaces the stored hero. Array/object fields may be JSON strings. Requires admin or chef.',
  })
  @ApiParam({ name: 'id', description: 'Ingredient ObjectId.' })
  @ApiBody({
    schema: { type: 'object', properties: INGREDIENT_MULTIPART_PROPERTIES },
  })
  @ApiOkResponse({ description: 'Updated ingredient.' })
  async updateIngredient(
    @Param('id') id: string,
    @Body() dto: UpdateIngredientDto,
    @UploadedFiles() files: { heroImage?: Express.Multer.File[] },
  ) {
    return this.ingrediantsService.updateIngredient(id, dto, files);
  }

  @Delete(':id')
  @Roles('ADMIN', 'CHEF')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiOperation({
    summary: 'Delete an ingredient',
    description: 'Deletes an ingredient by id. Requires admin or chef.',
  })
  @ApiParam({ name: 'id', description: 'Ingredient ObjectId.' })
  @ApiOkResponse({ description: 'Ingredient deleted.' })
  async deleteIngredient(@Param('id') id: string) {
    return this.ingrediantsService.deleteIngredient(id);
  }
}
