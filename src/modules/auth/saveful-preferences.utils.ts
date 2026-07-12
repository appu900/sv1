import {
  SavefulCadence,
  SavefulExperience,
  SavefulFocusArea,
} from 'src/database/schemas/user-saveful-preferences.schema';

export const SAVEFUL_PERSONAL_PLAN_VERSION = 1;

const FOCUS_PRIORITY: SavefulFocusArea[] = [
  'save_money',
  'use_what_i_already_have',
  'solve_whats_for_dinner',
  'plan_meals_and_shopping',
  'healthy_eating',
  'earn_rewards',
];

const ARCHITECTURE_TRACK_BY_FOCUS: Record<SavefulFocusArea, string> = {
  save_money: 'save_money',
  use_what_i_already_have: 'save_money',
  solve_whats_for_dinner: 'meal_rhythm',
  plan_meals_and_shopping: 'meal_rhythm',
  healthy_eating: 'healthy_eating',
  earn_rewards: 'rewards',
};

export interface DerivedSavefulPreferences {
  personalPlanKey?: string;
  personalPlanVersion?: number;
  recommendedExperience?: SavefulExperience;
  onboardingArchitectureTrack?: string;
}

export function deriveSavefulPreferences(params: {
  focusAreas?: SavefulFocusArea[];
  cadence?: SavefulCadence;
}): DerivedSavefulPreferences {
  const focusAreas = params.focusAreas ?? [];
  const cadence = params.cadence;

  if (focusAreas.length === 0 || !cadence) {
    return {};
  }

  const primaryFocus =
    FOCUS_PRIORITY.find(focusArea => focusAreas.includes(focusArea)) ??
    focusAreas[0];

  const recommendedExperience: SavefulExperience =
    cadence === 'getting_started'
      ? 'basic'
      : cadence === 'saveful_regular'
        ? 'hero'
        : 'legend';

  return {
    personalPlanKey: `${primaryFocus}__${cadence}`,
    personalPlanVersion: SAVEFUL_PERSONAL_PLAN_VERSION,
    recommendedExperience,
    onboardingArchitectureTrack: ARCHITECTURE_TRACK_BY_FOCUS[primaryFocus],
  };
}
