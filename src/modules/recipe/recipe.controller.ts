import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Logger,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiExtraModels,
} from '@nestjs/swagger';
import { sendCacheableJson } from '../../common/http/cacheable-json';
import { DataVersionService } from '../data-version/data-version.service';
import { RecipeService } from './recipe.service';
import { ServingScaleService } from './serving-scale.service';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import { ScaleServingsDto } from './dto/scale-servings.dto';
import { JwtAuthGuard } from './../../common/guards/jwt-auth.guard';
import { RolesGuard } from './../../common/guards/roles.guard';
import { Roles } from './../../common/decorators/role.decorators';
import { GetUser } from './../../common/decorators/Get.user.decorator';
import { UserRole } from '../../database/schemas/user.auth.schema';
import { ApiJwtAuth, ApiJwtRoles } from './../../common/swagger/api-auth.decorators';
import { plainToClass } from 'class-transformer';
import { validate } from 'class-validator';

const RECIPE_MULTIPART_PROPERTIES = {
  title: { type: 'string', description: 'Recipe title.' },
  shortDescription: { type: 'string', description: 'Short card blurb.' },
  longDescription: { type: 'string', description: 'Full recipe description.' },
  youtubeId: { type: 'string', description: 'Optional YouTube video id.' },
  heroImageUrl: {
    type: 'string',
    description: 'Existing hero image URL when not uploading a new file.',
  },
  portions: { type: 'string', description: 'Serving / portion label (e.g. "4").' },
  prepCookTime: { type: 'string', description: 'Prep + cook time in minutes.' },
  stickerId: { type: 'string', description: 'Optional sticker ObjectId.' },
  frameworkCategories: {
    type: 'string',
    description: 'JSON array of framework category ObjectIds.',
  },
  cuisines: { type: 'string', description: 'JSON array of cuisine ObjectIds.' },
  sponsorId: { type: 'string', description: 'Optional sponsor ObjectId.' },
  fridgeKeepTime: { type: 'string', description: 'Fridge keep-time label.' },
  freezeKeepTime: { type: 'string', description: 'Freezer keep-time label.' },
  hackOrTipIds: {
    type: 'string',
    description: 'JSON array of hack-or-tip ObjectIds.',
  },
  chefIds: { type: 'string', description: 'JSON array of chef ObjectIds.' },
  useLeftoversIn: {
    type: 'string',
    description: 'JSON array of leftover-recipe ObjectIds.',
  },
  components: {
    type: 'string',
    description: 'JSON array of recipe component wrappers (ingredients and steps).',
  },
  order: { type: 'string', description: 'Display order (integer).' },
  isActive: { type: 'string', description: 'Whether the recipe is published (`true`/`false`).' },
  countries: {
    type: 'string',
    description: 'JSON array of country codes this recipe is available in.',
  },
  heroImage: {
    type: 'string',
    format: 'binary',
    description: 'Hero image file. Uploaded to storage and stored as heroImageUrl.',
  },
};

@ApiTags('Recipes')
@ApiExtraModels(CreateRecipeDto, UpdateRecipeDto, ScaleServingsDto)
@Controller('api/recipe')
export class RecipeController {
  private readonly logger = new Logger(RecipeController.name);

  constructor(
    private readonly recipeService: RecipeService,
    private readonly servingScaleService: ServingScaleService,
    private readonly dataVersionService: DataVersionService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseInterceptors(FileInterceptor('heroImage'))
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Create a recipe',
    description:
      'Creates a recipe with components, categories, and an optional hero image. Array fields (`components`, `frameworkCategories`, `cuisines`, `hackOrTipIds`, `chefIds`, `useLeftoversIn`, `countries`) may be sent as JSON strings. Live path is `POST /api/api/recipe` because this controller is mounted at `api/recipe` under the global `api` prefix.',
  })
  @ApiBody({
    schema: { type: 'object', properties: RECIPE_MULTIPART_PROPERTIES },
  })
  @ApiCreatedResponse({ description: 'Recipe created.' })
  async create(
    @Body() body: any,
    @UploadedFile() heroImage?: Express.Multer.File,
  ) {
    this.logger.log('Received recipe creation request');
    this.logger.debug('Raw body keys:', Object.keys(body));

    const parsedBody = { ...body };

    const jsonFields = [
      'components',
      'frameworkCategories',
      'cuisines',
      'hackOrTipIds',
      'chefIds',
      'useLeftoversIn',
    ];

    for (const field of jsonFields) {
      if (typeof parsedBody[field] === 'string') {
        try {
          parsedBody[field] = JSON.parse(parsedBody[field]);
          this.logger.debug(
            `Parsed ${field}:`,
            JSON.stringify(parsedBody[field], null, 2),
          );
        } catch (error) {
          this.logger.error(`Failed to parse ${field}:`, error.message);
          throw new BadRequestException(
            `Invalid ${field} data: ${error.message}`,
          );
        }
      }
    }

    if (typeof parsedBody.prepCookTime === 'string') {
      parsedBody.prepCookTime = parseInt(parsedBody.prepCookTime, 10);
    }
    if (typeof parsedBody.order === 'string') {
      parsedBody.order = parseInt(parsedBody.order, 10);
    }

    if (typeof parsedBody.isActive === 'string') {
      parsedBody.isActive = parsedBody.isActive === 'true';
    }

    this.logger.debug('Parsed body:', JSON.stringify(parsedBody, null, 2));
    if (Array.isArray(parsedBody.components)) {
      this.logger.debug(
        `Parsed components count: ${parsedBody.components.length}`,
      );
      const firstWrapper = parsedBody.components[0];
      this.logger.debug(
        'First wrapper keys:',
        Object.keys(firstWrapper || {}),
      );
      const innerList = Array.isArray(firstWrapper?.component)
        ? firstWrapper.component
        : Array.isArray(firstWrapper?.components)
        ? firstWrapper.components
        : [];
      this.logger.debug(
        `First wrapper component count: ${innerList.length}`,
      );
      if (innerList[0]) {
        this.logger.debug(
          'First component keys:',
          Object.keys(innerList[0]),
        );
      }
    }

    const createRecipeDto = plainToClass(CreateRecipeDto, parsedBody, {
      enableImplicitConversion: true,
      exposeDefaultValues: true,
    });

    this.logger.debug(
      'Transformed DTO:',
      JSON.stringify(createRecipeDto, null, 2),
    );
    if (Array.isArray(createRecipeDto.components)) {
      this.logger.debug(
        `DTO components count: ${createRecipeDto.components.length}`,
      );
      const firstWrapper = createRecipeDto.components[0] as any;
      const innerList = Array.isArray(firstWrapper?.component)
        ? firstWrapper.component
        : [];
      this.logger.debug(
        `DTO first wrapper component count: ${innerList.length}`,
      );
    }

    const errors = await validate(createRecipeDto, {
      whitelist: true,
      forbidNonWhitelisted: false,
    });

    if (errors.length > 0) {
      this.logger.error('Validation errors:', JSON.stringify(errors, null, 2));
      const errorMessages = errors.map((err) => ({
        property: err.property,
        constraints: err.constraints,
        children: err.children?.map((child) => ({
          property: child.property,
          constraints: child.constraints,
        })),
      }));
      throw new BadRequestException({
        message: 'Validation failed',
        errors: errorMessages,
      });
    }

    this.logger.log('Validation passed, creating recipe...');
    return this.recipeService.create(createRecipeDto, heroImage);
  }

  @Get()
  @ApiOperation({
    summary: 'List recipes',
    description:
      'Returns the full recipe catalogue. Optionally filter by country code. Live path is `GET /api/api/recipe`.',
  })
  @ApiQuery({
    name: 'country',
    required: false,
    description: 'ISO country code to filter recipes (e.g. AU, IN).',
  })
  @ApiOkResponse({ description: 'Array of recipes.' })
  async findAll(@Query('country') country?: string) {
    return this.recipeService.findAll(country);
  }

  @Get('summaries')
  @ApiOperation({
    summary: 'List recipe summaries',
    description:
      'Lightweight recipe cards for list UIs (id, title, hero image, categories, cuisines, sticker). Supports a data-version pin via `v` and returns `ETag` / `X-Data-Version` for client cache invalidation. Live path is `GET /api/api/recipe/summaries`.',
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
      'Client data-version pin for the recipes collection. When it matches the current version the response is cacheable as immutable; otherwise caches must revalidate.',
  })
  @ApiOkResponse({ description: 'Array of recipe summaries.' })
  async findSummaries(
    @Req() req: Request,
    @Res() res: Response,
    @Query('country') country?: string,
    @Query('v') v?: string,
  ) {
    const [data, currentVersion] = await Promise.all([
      this.recipeService.findSummaries(country),
      this.dataVersionService.getVersion('recipes'),
    ]);
    return sendCacheableJson(req, res, data, {
      requestedVersion: v,
      currentVersion,
    });
  }

  @Get('category/:categoryId')
  @ApiOperation({
    summary: 'List recipes by framework category',
    description:
      'Returns recipes assigned to the given framework category. Live path is `GET /api/api/recipe/category/:categoryId`.',
  })
  @ApiParam({ name: 'categoryId', description: 'Framework category ObjectId.' })
  @ApiQuery({
    name: 'country',
    required: false,
    description: 'ISO country code to filter recipes (e.g. AU, IN).',
  })
  @ApiOkResponse({ description: 'Array of recipes in the category.' })
  async findByCategory(
    @Param('categoryId') categoryId: string,
    @Query('country') country?: string,
  ) {
    return this.recipeService.findByFrameworkCategory(categoryId, country);
  }

  @Get('ingredient/:ingredientId')
  @ApiOperation({
    summary: 'List recipes by ingredient',
    description:
      'Returns recipes that use the given ingredient. Live path is `GET /api/api/recipe/ingredient/:ingredientId`.',
  })
  @ApiParam({ name: 'ingredientId', description: 'Ingredient ObjectId.' })
  @ApiQuery({
    name: 'country',
    required: false,
    description: 'ISO country code to filter recipes (e.g. AU, IN).',
  })
  @ApiOkResponse({ description: 'Array of recipes that use the ingredient.' })
  async findByIngredient(
    @Param('ingredientId') ingredientId: string,
    @Query('country') country?: string,
  ) {
    return this.recipeService.findByIngredient(ingredientId, country);
  }

  @Post('scale-servings')
  @ApiOperation({
    summary: 'Scale recipe servings',
    description:
      'Scales a list of ingredient quantities from `originalServings` to `desiredServings` (1–20). Public; no auth required. Live path is `POST /api/api/recipe/scale-servings`.',
  })
  @ApiBody({ type: ScaleServingsDto })
  @ApiOkResponse({ description: 'Scaled ingredient quantities and optional cooking notes.' })
  async scaleServings(@Body() body: ScaleServingsDto) {
    this.logger.log(
      `Scaling servings: ${body.originalServings} → ${body.desiredServings} (${body.ingredients?.length || 0} ingredients)`,
    );

    const dto = plainToClass(ScaleServingsDto, body, {
      enableImplicitConversion: true,
    });

    const errors = await validate(dto);
    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: errors.map((e) => ({
          property: e.property,
          constraints: e.constraints,
        })),
      });
    }

    return this.servingScaleService.scaleServings(dto);
  }

  @Get('by-slug/:slug')
  @ApiOperation({
    summary: 'Get recipe by slug',
    description:
      'Looks up a single recipe by its URL slug. Live path is `GET /api/api/recipe/by-slug/:slug`.',
  })
  @ApiParam({ name: 'slug', description: 'Recipe URL slug.' })
  @ApiOkResponse({ description: 'Full recipe document.' })
  async findBySlug(@Param('slug') slug: string) {
    return this.recipeService.findBySlug(slug);
  }

  @Get('dietary-recommendations')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Get dietary recipe recommendations',
    description:
      'Returns recipes that match the caller’s dietary profile. Query params override the stored profile (`vegType`, `dairyFree`, `nutFree`, `glutenFree`, `hasDiabetes`, `country`). Requires a JWT. Live path is `GET /api/api/recipe/dietary-recommendations`.',
  })
  @ApiQuery({
    name: 'vegType',
    required: false,
    description: 'Override vegetarian type: `VEGAN` or `VEGETARIAN`. Defaults to the user dietary profile.',
  })
  @ApiQuery({
    name: 'dairyFree',
    required: false,
    description: '`true`/`false`. Defaults to the user dietary profile.',
  })
  @ApiQuery({
    name: 'nutFree',
    required: false,
    description: '`true`/`false`. Defaults to the user dietary profile.',
  })
  @ApiQuery({
    name: 'glutenFree',
    required: false,
    description: '`true`/`false`. Defaults to the user dietary profile.',
  })
  @ApiQuery({
    name: 'hasDiabetes',
    required: false,
    description: '`true`/`false`. Defaults to the user dietary profile.',
  })
  @ApiQuery({
    name: 'country',
    required: false,
    description: 'ISO country code. Defaults to the authenticated user’s country.',
  })
  @ApiOkResponse({ description: 'Recommended recipes for the dietary filters.' })
  async getDietaryRecommendations(
    @GetUser() user: any,
    @Query('vegType') vegType?: string,
    @Query('dairyFree') dairyFree?: string,
    @Query('nutFree') nutFree?: string,
    @Query('glutenFree') glutenFree?: string,
    @Query('hasDiabetes') hasDiabetes?: string,
    @Query('country') country?: string,
  ) {
    const dp = user?.dietaryProfile;
    return this.recipeService.getDietaryRecommendations({
      vegType:    vegType    ?? dp?.vegType,
      dairyFree:  dairyFree  !== undefined ? dairyFree  === 'true' : dp?.dairyFree,
      nutFree:    nutFree    !== undefined ? nutFree    === 'true' : dp?.nutFree,
      glutenFree: glutenFree !== undefined ? glutenFree === 'true' : dp?.glutenFree,
      hasDiabetes:hasDiabetes!== undefined ? hasDiabetes === 'true': dp?.hasDiabetes,
      country:    country    ?? user?.country,
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get recipe by id',
    description:
      'Returns a full recipe document by Mongo ObjectId. Live path is `GET /api/api/recipe/:id`.',
  })
  @ApiParam({ name: 'id', description: 'Recipe ObjectId.' })
  @ApiOkResponse({ description: 'Full recipe document.' })
  async findOne(@Param('id') id: string) {
    return this.recipeService.findOne(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseInterceptors(FileInterceptor('heroImage'))
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Update a recipe',
    description:
      'Partial update of a recipe. Send only fields to change. Array fields may be JSON strings. Optional new `heroImage` replaces the stored hero. Live path is `PUT /api/api/recipe/:id`.',
  })
  @ApiParam({ name: 'id', description: 'Recipe ObjectId.' })
  @ApiBody({
    schema: { type: 'object', properties: RECIPE_MULTIPART_PROPERTIES },
  })
  @ApiOkResponse({ description: 'Updated recipe.' })
  async update(
    @Param('id') id: string,
    @Body() body: any,
    @UploadedFile() heroImage?: Express.Multer.File,
  ) {
    this.logger.log(`Received recipe update request for ID: ${id}`);
    this.logger.debug('Raw body keys:', Object.keys(body));

    const parsedBody = { ...body };

    const jsonFields = [
      'components',
      'frameworkCategories',
      'cuisines',
      'hackOrTipIds',
      'chefIds',
      'useLeftoversIn',
    ];

    for (const field of jsonFields) {
      if (
        parsedBody[field] !== undefined &&
        typeof parsedBody[field] === 'string'
      ) {
        try {
          parsedBody[field] = JSON.parse(parsedBody[field]);
          this.logger.debug(
            `Parsed ${field}:`,
            JSON.stringify(parsedBody[field], null, 2),
          );
        } catch (error) {
          this.logger.error(`Failed to parse ${field}:`, error.message);
          throw new BadRequestException(`Invalid ${field} data`);
        }
      }
    }

    if (typeof parsedBody.prepCookTime === 'string') {
      parsedBody.prepCookTime = parseInt(parsedBody.prepCookTime, 10);
    }
    if (typeof parsedBody.order === 'string') {
      parsedBody.order = parseInt(parsedBody.order, 10);
    }
    if (typeof parsedBody.isActive === 'string') {
      parsedBody.isActive = parsedBody.isActive === 'true';
    }

    this.logger.debug('Parsed body:', JSON.stringify(parsedBody, null, 2));

    const updateRecipeDto = plainToClass(UpdateRecipeDto, parsedBody, {
      enableImplicitConversion: true,
      exposeDefaultValues: true,
    });

    this.logger.debug(
      'Transformed DTO:',
      JSON.stringify(updateRecipeDto, null, 2),
    );

    const errors = await validate(updateRecipeDto, {
      whitelist: true,
      forbidNonWhitelisted: false,
    });

    if (errors.length > 0) {
      this.logger.error('Validation errors:', JSON.stringify(errors, null, 2));
      const errorMessages = errors.map((err) => ({
        property: err.property,
        constraints: err.constraints,
        children: err.children?.map((child) => ({
          property: child.property,
          constraints: child.constraints,
        })),
      }));
      throw new BadRequestException({
        message: 'Validation failed',
        errors: errorMessages,
      });
    }

    this.logger.log('Validation passed, updating recipe...');
    return this.recipeService.update(id, updateRecipeDto, heroImage);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @ApiJwtRoles('Requires admin or chef role.')
  @ApiOperation({
    summary: 'Delete a recipe',
    description:
      'Permanently deletes a recipe by id. Live path is `DELETE /api/api/recipe/:id`.',
  })
  @ApiParam({ name: 'id', description: 'Recipe ObjectId.' })
  @ApiOkResponse({ description: 'Recipe deleted successfully.' })
  async remove(@Param('id') id: string) {
    await this.recipeService.remove(id);
    return { message: 'Recipe deleted successfully' };
  }
}
