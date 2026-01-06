import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsNumber,
  IsBoolean,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';


export class AlternativeIngredientDto {
  @IsString()
  @IsNotEmpty()
  ingredient: string; 

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  inheritQuantity?: boolean;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  inheritPreparation?: boolean;

  @IsString()
  @IsOptional()
  quantity?: string;

  @IsString()
  @IsOptional()
  preparation?: string;
}


export class RequiredIngredientDto {
  @IsString()
  @IsNotEmpty()
  recommendedIngredient: string; 

  @IsString()
  @IsNotEmpty()
  quantity: string;

  @IsString()
  @IsNotEmpty()
  preparation: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => AlternativeIngredientDto)
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return [];
      }
    }
    return value || [];
  })
  alternativeIngredients?: AlternativeIngredientDto[];
}

export class OptionalIngredientDto {
  @IsString()
  @IsNotEmpty()
  ingredient: string; 

  @IsString()
  @IsNotEmpty()
  quantity: string;

  @IsString()
  @IsNotEmpty()
  preparation: string;
}

export class ComponentStepDto {
  @IsString()
  @IsNotEmpty()
  stepInstructions: string; 

  @IsArray()
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return value || [];
  })
  hackOrTipIds?: string[]; 

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  alwaysShow?: boolean;

  @IsArray()
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return value || [];
  })
  relevantIngredients?: string[]; 
}


export class ComponentDto {
  @IsString()
  @IsNotEmpty()
  componentTitle: string;

  @IsString()
  @IsOptional()
  componentInstructions?: string;

  @IsArray()
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return value || [];
  })
  includedInVariants?: string[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => RequiredIngredientDto)
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return [];
      }
    }
    return value || [];
  })
  requiredIngredients?: RequiredIngredientDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OptionalIngredientDto)
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return [];
      }
    }
    return value || [];
  })
  optionalIngredients?: OptionalIngredientDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ComponentStepDto)
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return [];
      }
    }
    return value || [];
  })
  componentSteps?: ComponentStepDto[];
}


export class RecipeComponentWrapperDto {
  @IsString()
  @IsOptional()
  prepShortDescription?: string;

  @IsString()
  @IsOptional()
  prepLongDescription?: string;

  @IsArray()
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return value || [];
  })
  variantTags?: string[];

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  stronglyRecommended?: boolean;

  @IsString()
  @IsOptional()
  choiceInstructions?: string;

  @IsString()
  @IsOptional()
  buttonText?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ComponentDto)
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return [];
      }
    }
    return value || [];
  })
  component: ComponentDto[];
}

export class CreateRecipeDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  shortDescription: string;

  @IsString()
  @IsNotEmpty()
  longDescription: string;

  @IsArray()
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return value || [];
  })
  hackOrTipIds?: string[];

  @IsString()
  @IsOptional()
  heroImageUrl?: string;

  @IsString()
  @IsOptional()
  youtubeId?: string;

  @IsString()
  @IsNotEmpty()
  portions: string;

  @IsNumber()
  @Transform(({ value }) => (value ? parseInt(value, 10) : 0))
  prepCookTime: number;

  @IsString()
  @IsOptional()
  stickerId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return value || [];
  })
  frameworkCategories: string[];

  @IsString()
  @IsOptional()
  sponsorId?: string;

  @IsString()
  @IsOptional()
  fridgeKeepTime?: string;

  @IsString()
  @IsOptional()
  freezeKeepTime?: string;

  @IsArray()
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return value || [];
  })
  useLeftoversIn?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecipeComponentWrapperDto)
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return [];
      }
    }
    return value || [];
  })
  components: RecipeComponentWrapperDto[];

  @IsNumber()
  @IsOptional()
  @Transform(({ value }) => (value ? parseInt(value, 10) : 0))
  order?: number;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isActive?: boolean;
}