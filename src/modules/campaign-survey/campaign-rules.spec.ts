import { CHRISTMAS_2026 } from './campaigns';
import {
  addCalendarMonths,
  answerBlocker,
  canActivate,
  giftFor,
  validateAnswers,
  windowState,
} from './campaign-rules';

const c = CHRISTMAS_2026;

function fullAnswers(overrides: Record<string, { selected: string[]; other?: string }> = {}) {
  const base: Record<string, { selected: string[]; other?: string }> = {
    food_budget_change: { selected: ['same'] },
    food_spend: { selected: ['250_499'] },
    cost_pressures: { selected: ['specials', 'fewer_people'] },
    total_spend_change: { selected: ['little_less'] },
    budget_plans: { selected: ['plan_ahead'] },
    leftovers: { selected: ['freeze', 'send_home'] },
    ...overrides,
  };
  return Object.entries(base).map(([questionId, a]) => ({ questionId, ...a }));
}

describe('Christmas 2026 window (AEDT)', () => {
  it('opens at midnight on 1 December in Sydney', () => {
    expect(windowState(c, new Date('2026-11-30T12:59:59Z'))).toBe('not_open'); // 30 Nov 23:59:59 AEDT
    expect(windowState(c, new Date('2026-11-30T13:00:00Z'))).toBe('open'); // 1 Dec 00:00 AEDT
  });

  it('closes after 14 December in Sydney', () => {
    expect(windowState(c, new Date('2026-12-14T12:59:59Z'))).toBe('open'); // 14 Dec 23:59:59 AEDT
    expect(windowState(c, new Date('2026-12-14T13:00:00Z'))).toBe('closed'); // 15 Dec 00:00 AEDT
  });

  it('allows activation until the end of 31 December in Sydney', () => {
    expect(canActivate(c, new Date('2026-12-31T12:59:59Z'))).toBe(true);
    expect(canActivate(c, new Date('2026-12-31T13:00:00Z'))).toBe(false);
    expect(canActivate(c, new Date('2027-02-01T00:00:00Z'), true)).toBe(true);
  });
});

describe('who can answer', () => {
  const open = new Date('2026-12-05T00:00:00Z');

  it('is Australia only', () => {
    expect(answerBlocker(c, { now: open, country: 'Australia' })).toBeNull();
    expect(answerBlocker(c, { now: open, country: 'India' })).toBe('country');
    expect(answerBlocker(c, { now: open, country: null })).toBe('country');
  });

  it('reports the window before the country', () => {
    expect(answerBlocker(c, { now: new Date('2026-11-20T00:00:00Z'), country: 'India' })).toBe('not_open');
  });

  it('lets QA accounts through at any time and from anywhere', () => {
    expect(answerBlocker(c, { now: new Date('2026-11-20T00:00:00Z'), country: 'India', bypass: true })).toBeNull();
  });
});

describe('validateAnswers', () => {
  it('accepts a complete set and keeps the labels', () => {
    const result = validateAnswers(c, fullAnswers());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answers).toHaveLength(6);
      expect(result.answers[2].labels).toEqual([
        'Buying more specials or discounted products',
        'Entertaining fewer people',
      ]);
    }
  });

  it('needs every question answered', () => {
    const answers = fullAnswers().filter(a => a.questionId !== 'leftovers');
    expect(validateAnswers(c, answers).ok).toBe(false);
  });

  it('allows one answer only on single-choice questions', () => {
    expect(validateAnswers(c, fullAnswers({ food_spend: { selected: ['under_100', 'not_sure'] } })).ok).toBe(false);
  });

  it('needs text for "Other"', () => {
    expect(validateAnswers(c, fullAnswers({ cost_pressures: { selected: ['other'] } })).ok).toBe(false);
    const ok = validateAnswers(c, fullAnswers({ cost_pressures: { selected: ['other'], other: ' Fewer gifts ' } }));
    expect(ok.ok && ok.answers[2].other).toBe('Fewer gifts');
  });

  it('drops "Other" text when Other is not chosen', () => {
    const r = validateAnswers(c, fullAnswers({ budget_plans: { selected: ['shop_around'], other: 'ignored' } }));
    expect(r.ok && r.answers[4].other).toBeUndefined();
  });

  it('keeps "Not applicable" on its own', () => {
    expect(validateAnswers(c, fullAnswers({ leftovers: { selected: ['not_applicable', 'freeze'] } })).ok).toBe(false);
    expect(validateAnswers(c, fullAnswers({ leftovers: { selected: ['not_applicable'] } })).ok).toBe(true);
  });

  it('rejects unknown questions and choices', () => {
    expect(validateAnswers(c, [...fullAnswers(), { questionId: 'nope', selected: ['x'] }]).ok).toBe(false);
    expect(validateAnswers(c, fullAnswers({ food_spend: { selected: ['a_lot'] } })).ok).toBe(false);
  });
});

describe('giftFor', () => {
  it('gives Hero to free users, Legend to paying Hero members and nothing extra to Legend', () => {
    expect(giftFor('basic')).toBe('hero');
    expect(giftFor('hero')).toBe('legend');
    expect(giftFor('legend')).toBeNull();
  });
});

describe('addCalendarMonths', () => {
  it('adds calendar months and clamps to the last day', () => {
    expect(addCalendarMonths(new Date('2026-12-05T10:00:00Z'), 2).toISOString()).toBe('2027-02-05T10:00:00.000Z');
    expect(addCalendarMonths(new Date('2026-12-31T10:00:00Z'), 2).toISOString()).toBe('2027-02-28T10:00:00.000Z');
  });
});
