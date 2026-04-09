/// <reference types="jest" />

import { Types } from 'mongoose';
import { localDateISO } from '../../common/utils/timezone.util';
import {
  ActivityLevel,
  GoalType,
} from '../../database/schemas/nutrition/health-profile.schema';
import { HealthProfileService } from './health-profile.service';

function mockQueryResult<T>(value: T) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('HealthProfileService', () => {
  const userId = new Types.ObjectId().toHexString();

  let profileModel: any;
  let dailyModel: any;
  let userModel: any;
  let service: HealthProfileService;

  beforeEach(() => {
    profileModel = {
      findOne: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    };
    dailyModel = {
      findOne: jest.fn(),
      find: jest.fn(),
      updateOne: jest.fn(),
    };
    userModel = {
      findById: jest.fn(),
    };

    service = new HealthProfileService(profileModel, dailyModel, userModel, null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns cached daily recommendations without regenerating when the cache key matches', async () => {
    const today = localDateISO('UTC');
    const profile = {
      targets: {
        kcal: 2000,
        protein_g: 100,
        carbs_g: 250,
        fat_g: 60,
        fiber_g: 30,
        water_ml: 2500,
      },
      weight: { kg: 70 },
      age: 30,
      gender: 'male',
      goal: GoalType.MAINTAIN,
      activityLevel: ActivityLevel.MODERATE,
    };
    const todayDoc = {
      totals: { kcal: 1200, protein_g: 55, carbs_g: 130, fat_g: 30, fiber_g: 12 },
      waterIntake: { total_ml: 900 },
    };
    const recentDays = [
      {
        date: today,
        totals: todayDoc.totals,
        waterIntake: todayDoc.waterIntake,
        entries: [{}],
      },
    ];
    const todaySummary = {
      kcal: 1200,
      protein_g: 55,
      carbs_g: 130,
      fat_g: 30,
      water_ml: 900,
    };
    const cacheKey = (service as any).buildDailyRecommendationCacheKey(
      profile.targets,
      todaySummary,
      recentDays,
    );

    profileModel.findOne.mockReturnValueOnce(mockQueryResult(profile));
    userModel.findById.mockReturnValueOnce(mockQueryResult({ timezone: 'UTC', country: 'IN' }));
    dailyModel.findOne
      .mockReturnValueOnce(
        mockQueryResult({
          ...todayDoc,
          dailyRecommendation: {
            recommendations: ['cached recommendation'],
            cacheKey,
          },
        }),
      )
      .mockReturnValueOnce(mockQueryResult(null));
    dailyModel.find.mockReturnValueOnce(mockQueryResult(recentDays));
    dailyModel.updateOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({}) });

    const generatorSpy = jest.spyOn(service as any, 'generateDailyAiRecommendations');

    const result = await service.getDailyRecommendation(userId);

    expect(result.recommendations).toEqual(['cached recommendation']);
    expect(generatorSpy).not.toHaveBeenCalled();
    expect(dailyModel.updateOne).not.toHaveBeenCalled();
  });

  it('regenerates and persists daily recommendations when the cache is stale', async () => {
    const today = localDateISO('UTC');
    const profile = {
      targets: {
        kcal: 2000,
        protein_g: 100,
        carbs_g: 250,
        fat_g: 60,
        fiber_g: 30,
        water_ml: 2500,
      },
      weight: { kg: 70 },
      age: 30,
      gender: 'male',
      goal: GoalType.MAINTAIN,
      activityLevel: ActivityLevel.MODERATE,
    };
    const todayDoc = {
      totals: { kcal: 1200, protein_g: 55, carbs_g: 130, fat_g: 30, fiber_g: 12 },
      waterIntake: { total_ml: 900 },
    };
    const recentDays = [
      {
        date: today,
        totals: todayDoc.totals,
        waterIntake: todayDoc.waterIntake,
        entries: [{}],
      },
    ];

    profileModel.findOne.mockReturnValueOnce(mockQueryResult(profile));
    userModel.findById.mockReturnValueOnce(mockQueryResult({ timezone: 'UTC', country: 'IN' }));
    dailyModel.findOne
      .mockReturnValueOnce(
        mockQueryResult({
          ...todayDoc,
          dailyRecommendation: {
            recommendations: ['old recommendation'],
            cacheKey: 'stale-key',
          },
        }),
      )
      .mockReturnValueOnce(
        mockQueryResult({
          dailyRecommendation: {
            recommendations: ['yesterday recommendation'],
          },
        }),
      );
    dailyModel.find.mockReturnValueOnce(mockQueryResult(recentDays));
    dailyModel.updateOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({}) });

    const generatorSpy = jest
      .spyOn(service as any, 'generateDailyAiRecommendations')
      .mockResolvedValue(['fresh recommendation']);

    const result = await service.getDailyRecommendation(userId);

    expect(result.recommendations).toEqual(['fresh recommendation']);
    expect(generatorSpy).toHaveBeenCalledWith(
      profile,
      {
        kcal: 1200,
        protein_g: 55,
        carbs_g: 130,
        fat_g: 30,
        water_ml: 900,
      },
      recentDays,
      today,
      ['yesterday recommendation'],
    );
    expect(dailyModel.updateOne).toHaveBeenCalledWith(
      { userId: new Types.ObjectId(userId), date: today },
      expect.objectContaining({
        $set: expect.objectContaining({
          dailyRecommendation: expect.objectContaining({
            recommendations: ['fresh recommendation'],
          }),
        }),
      }),
      { upsert: true },
    );
  });

  it('reuses a monthly snapshot when the snapshot cache key still matches', async () => {
    const profile: any = {
      userId: new Types.ObjectId(),
      goal: GoalType.MAINTAIN,
      activityLevel: ActivityLevel.MODERATE,
      weight: { kg: 70 },
      height: { cm: 170 },
      targets: {
        kcal: 2000,
        protein_g: 100,
        carbs_g: 250,
        fat_g: 60,
        fiber_g: 30,
        water_ml: 2500,
      },
      monthlySnapshots: [],
      markModified: jest.fn(),
    };
    const dailies = [
      {
        date: '2026-04-09',
        totals: { kcal: 1900, protein_g: 95, carbs_g: 240, fat_g: 58, fiber_g: 28 },
        waterIntake: { total_ml: 2200 },
        entries: [{}],
      },
    ];
    const cacheKey = (service as any).buildMonthlySnapshotCacheKey(profile, '2026-04', dailies);
    const existingSnapshot = {
      month: '2026-04',
      avgDailyKcal: 1900,
      avgProtein_g: 95,
      avgCarbs_g: 240,
      avgFat_g: 58,
      avgFiber_g: 28,
      avgWater_ml: 2200,
      daysLogged: 1,
      daysOnTarget: 1,
      weightKg: 70,
      bmi: 24.2,
      targetSnapshot: profile.targets,
      aiRecommendations: ['keep existing'],
      cacheKey,
    };
    profile.monthlySnapshots = [existingSnapshot];

    dailyModel.find.mockReturnValueOnce(mockQueryResult(dailies));
    const snapshotRecommendationSpy = jest.spyOn(service as any, 'generateSnapshotRecommendations');

    const result = await (service as any).generateMonthlySnapshotForMonth(profile, '2026-04');

    expect(result).toBe(existingSnapshot);
    expect(snapshotRecommendationSpy).not.toHaveBeenCalled();
    expect(profile.markModified).not.toHaveBeenCalled();
  });

  it('regenerates a monthly snapshot when the cache key no longer matches', async () => {
    const profile: any = {
      userId: new Types.ObjectId(),
      goal: GoalType.MAINTAIN,
      activityLevel: ActivityLevel.MODERATE,
      weight: { kg: 70 },
      height: { cm: 170 },
      targets: {
        kcal: 2000,
        protein_g: 100,
        carbs_g: 250,
        fat_g: 60,
        fiber_g: 30,
        water_ml: 2500,
      },
      monthlySnapshots: [
        {
          month: '2026-04',
          avgDailyKcal: 1800,
          avgProtein_g: 90,
          avgCarbs_g: 220,
          avgFat_g: 55,
          avgFiber_g: 25,
          avgWater_ml: 2000,
          daysLogged: 1,
          daysOnTarget: 0,
          weightKg: 70,
          bmi: 24.2,
          targetSnapshot: null,
          aiRecommendations: ['old snapshot'],
          cacheKey: 'old-key',
        },
      ],
      markModified: jest.fn(),
    };
    const dailies = [
      {
        date: '2026-04-09',
        totals: { kcal: 2100, protein_g: 110, carbs_g: 260, fat_g: 62, fiber_g: 31 },
        waterIntake: { total_ml: 2400 },
        entries: [{}],
      },
    ];

    dailyModel.find.mockReturnValueOnce(mockQueryResult(dailies));
    jest
      .spyOn(service as any, 'generateSnapshotRecommendations')
      .mockResolvedValue(['fresh monthly tip']);

    const result = await (service as any).generateMonthlySnapshotForMonth(profile, '2026-04');

    expect(result.aiRecommendations).toEqual(['fresh monthly tip']);
    expect(result.cacheKey).not.toBe('old-key');
    expect(profile.monthlySnapshots[0].aiRecommendations).toEqual(['fresh monthly tip']);
    expect(profile.markModified).toHaveBeenCalledWith('monthlySnapshots');
  });
});