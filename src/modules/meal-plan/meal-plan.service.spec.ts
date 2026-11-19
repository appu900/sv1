import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { MealPlanService } from './meal-plan.service';

const userId = new Types.ObjectId().toHexString();
const planId = new Types.ObjectId().toHexString();

function meal(slot: string, title: string, kcal: number) {
  return {
    slot,
    title,
    description: '',
    estimatedNutrition: { kcal, protein_g: 10, carbs_g: 10, fat_g: 5, fiber_g: 2 },
    ingredients: [],
    inventoryMatches: [],
    missingIngredients: [],
    fromInventory: false,
  };
}

function setup() {
  const plan: any = {
    _id: new Types.ObjectId(planId),
    days: [
      {
        dayNumber: 1,
        label: 'Day 1 — Monday',
        meals: [meal('breakfast', 'Oats', 300), meal('lunch', 'Dal', 500)],
        daySummary: { kcal: 800, protein_g: 20, carbs_g: 20, fat_g: 10, fiber_g: 4 },
      },
    ],
    markModified: jest.fn(),
    save: jest.fn(async () => plan),
  };
  const chain = (value: unknown) => {
    const c: any = { select: () => c, sort: () => c, lean: () => c, exec: async () => value, then: (r: any) => r(value) };
    return c;
  };
  const mealPlanModel = { findOne: jest.fn(async () => plan) };
  const healthProfileModel = { findOne: jest.fn(() => chain(null)) };
  const inventoryModel = { find: jest.fn(() => chain([])) };
  const userModel = { findById: jest.fn(() => chain({ country: 'AU', dietaryProfile: {} })) };
  const mealPlanAi = { generateSingleMeal: jest.fn(async (_ctx: any, req: any) => meal(req.slot, 'Shakshuka', 420)) };
  const service = new MealPlanService(
    mealPlanModel as any,
    healthProfileModel as any,
    inventoryModel as any,
    userModel as any,
    {} as any,
    {} as any,
    mealPlanAi as any,
    {} as any,
    {} as any,
  );
  return { service, plan, mealPlanAi };
}

describe('MealPlanService.changeMeal', () => {
  it('swaps a meal, avoids repeats and recalculates the day', async () => {
    const { service, plan, mealPlanAi } = setup();
    await service.changeMeal(userId, planId, { dayNumber: 1, slot: 'breakfast', mode: 'swap' });
    const req = (mealPlanAi.generateSingleMeal as jest.Mock).mock.calls[0][1];
    expect(req).toMatchObject({ slot: 'breakfast', replacing: 'Oats', avoidTitles: ['Oats', 'Dal'] });
    expect(plan.days[0].meals.map((m: any) => m.title)).toEqual(['Shakshuka', 'Dal']);
    expect(plan.days[0].daySummary.kcal).toBe(920);
    expect(plan.save).toHaveBeenCalled();
  });

  it('adds a meal to the day', async () => {
    const { service, plan } = setup();
    await service.changeMeal(userId, planId, { dayNumber: 1, slot: 'snack', mode: 'add' });
    expect(plan.days[0].meals).toHaveLength(3);
    expect(plan.days[0].daySummary.kcal).toBe(1220);
  });

  it('refuses to swap a slot that has no meal', async () => {
    const { service } = setup();
    await expect(service.changeMeal(userId, planId, { dayNumber: 1, slot: 'dinner', mode: 'swap' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
