export type SubscriptionPlan = 'basic' | 'hero' | 'legend';
export type SubscriptionStatus =
  | 'active'
  | 'in_trial'
  | 'cancelled'
  | 'expired'
  | 'paused';

export const SAVEFUL_ENTITLEMENT = 'saveful_pro';

export const PRODUCT_TO_PLAN: Record<string, SubscriptionPlan> = {
  monthly: 'hero',
  yearly: 'hero',
  lifetime: 'legend',

  saveful_hero: 'hero',
  saveful_hero_monthly: 'hero',
  saveful_hero_yearly: 'hero',
  saveful_premium: 'hero',
  saveful_premium_monthly: 'hero',
  saveful_premium_yearly: 'hero',

  saveful_legend: 'legend',
  saveful_legend_monthly: 'legend',
  saveful_legend_yearly: 'legend',
  saveful_legend_lifetime: 'legend',
  saveful_premium_plus: 'legend',
  saveful_premium_plus_monthly: 'legend',
  saveful_premium_plus_yearly: 'legend',
};

export const PLAN_PREFIX_RULES: Array<{ match: RegExp; plan: SubscriptionPlan }> = [
  { match: /(legend|premium[_-]?plus|\bplus\b)/i, plan: 'legend' },
  { match: /(hero|premium|\bpro\b)/i, plan: 'hero' },
];

export const UNLIMITED = -1;

export interface PlanLimits {
  aiMealsPerMonth: number;
  ingredients: number;
  cookbooks: number;
  shoppingLists: number;
  kitchenScansPerMonth: number;
}

export interface PlanDefinition {
  plan: SubscriptionPlan;
  label: string;
  isPaid: boolean;
  limits: PlanLimits;
  features: string[];
}

export const PLANS: Record<SubscriptionPlan, PlanDefinition> = {
  basic: {
    plan: 'basic',
    label: 'Saveful Basic',
    isPaid: false,
    limits: {
      aiMealsPerMonth: 3,
      ingredients: 20,
      cookbooks: 5,
      shoppingLists: 5,
      kitchenScansPerMonth: 0,
    },
    features: [
      'ingredient_to_meal',
      'kitchen_tracking',
      'shopping_lists',
      'recipe_saving',
      'basic_savings',
      'basic_ai',
    ],
  },
  hero: {
    plan: 'hero',
    label: 'Saveful Hero',
    isPaid: true,
    limits: {
      aiMealsPerMonth: 15,
      ingredients: 50,
      cookbooks: 20,
      shoppingLists: 50,
      kitchenScansPerMonth: 0,
    },
    features: [
      'ingredient_to_meal',
      'kitchen_tracking',
      'shopping_lists',
      'recipe_saving',
      'basic_savings',
      'basic_ai',
      'smart_meal_planning',
      'nutrition_insights',
      'leftover_transformations',
      'recipe_conversions',
      'goal_tracking',
      'advanced_savings',
    ],
  },
  legend: {
    plan: 'legend',
    label: 'Saveful Legend',
    isPaid: true,
    limits: {
      aiMealsPerMonth: UNLIMITED,
      ingredients: UNLIMITED,
      cookbooks: UNLIMITED,
      shoppingLists: UNLIMITED,
      kitchenScansPerMonth: UNLIMITED,
    },
    features: [
      'ingredient_to_meal',
      'kitchen_tracking',
      'shopping_lists',
      'recipe_saving',
      'basic_savings',
      'basic_ai',
      'smart_meal_planning',
      'nutrition_insights',
      'leftover_transformations',
      'recipe_conversions',
      'goal_tracking',
      'advanced_savings',
      'barcode_scanning',
      'nutrition_coaching',
      'unlimited_ai',
      'full_ai_tools',
      'priority_access',
    ],
  },
};

export type FeatureKey =
  | 'ingredient_to_meal'
  | 'kitchen_tracking'
  | 'shopping_lists'
  | 'recipe_saving'
  | 'basic_savings'
  | 'basic_ai'
  | 'smart_meal_planning'
  | 'nutrition_insights'
  | 'leftover_transformations'
  | 'recipe_conversions'
  | 'goal_tracking'
  | 'advanced_savings'
  | 'barcode_scanning'
  | 'nutrition_coaching'
  | 'unlimited_ai'
  | 'full_ai_tools'
  | 'priority_access';

export type LimitKey = keyof PlanLimits;

export const TRIAL_DAYS = 7;
