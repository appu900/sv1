import { WasteType } from '../../database/schemas/user-inventory.schema';
import {
  normaliseWasteType,
  parsePeriod,
  periodStart,
  rekeyCounts,
  toLegacyWasteType,
} from './waste-types';

describe('waste types', () => {
  it('stores old bins as the new ones', () => {
    expect(normaliseWasteType('wet_waste')).toBe(WasteType.FOOD_ORGANICS);
    expect(normaliseWasteType('dry_waste')).toBe(WasteType.RECYCLING);
    expect(normaliseWasteType('hazardous')).toBe(WasteType.GENERAL_WASTE);
    expect(normaliseWasteType('recycling')).toBe(WasteType.RECYCLING);
    expect(normaliseWasteType('rubbish')).toBeUndefined();
    expect(normaliseWasteType(undefined)).toBeUndefined();
  });

  it('gives older apps keys they know', () => {
    expect(toLegacyWasteType('food_organics')).toBe(WasteType.WET);
    expect(toLegacyWasteType('recycling')).toBe(WasteType.DRY);
    expect(toLegacyWasteType('general_waste')).toBe(WasteType.DRY);
    expect(toLegacyWasteType('hazardous')).toBe(WasteType.HAZARDOUS);
  });

  it('merges counts when keys collapse', () => {
    const current = rekeyCounts({ wet_waste: 3, food_organics: 2, hazardous: 1, unknown: 4 }, normaliseWasteType);
    expect(current).toEqual({ food_organics: 5, general_waste: 1, unknown: 4 });
    const legacy = rekeyCounts({ recycling: 2, general_waste: 1 }, toLegacyWasteType);
    expect(legacy).toEqual({ dry_waste: 3 });
  });

  it('builds rolling windows', () => {
    const now = Date.UTC(2026, 10, 30);
    expect(periodStart('all', now)).toBeNull();
    expect(periodStart('7d', now)?.toISOString()).toBe('2026-11-23T00:00:00.000Z');
    expect(periodStart('90d', now)?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(parsePeriod('30d')).toBe('30d');
    expect(parsePeriod('1y')).toBe('all');
    expect(parsePeriod(undefined)).toBe('all');
  });
});
