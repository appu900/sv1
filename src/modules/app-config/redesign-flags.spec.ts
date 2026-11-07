import { clientAtLeast, getClientVersion } from '../../common/http/client-version';
import {
  normaliseRules,
  REDESIGN_AREAS,
  resolveRedesignFlags,
  rolloutBucket,
} from './redesign-flags';

const on = { enabled: true, percent: 100, allowUserIds: [] };
const viewer = { userId: 'user-1', appVersion: '4.1.0' };

describe('resolveRedesignFlags', () => {
  it('turns everything off when nothing is configured', () => {
    const flags = resolveRedesignFlags(null, viewer);
    expect(Object.values(flags).every(v => v === false)).toBe(true);
    expect(Object.keys(flags).sort()).toEqual([...REDESIGN_AREAS].sort());
  });

  it('turns on an enabled area at 100%', () => {
    expect(resolveRedesignFlags({ cookbook: on }, viewer).cookbook).toBe(true);
  });

  it('keeps a disabled area off even at 100% or on the allow list', () => {
    const rule = { enabled: false, percent: 100, allowUserIds: ['user-1'] };
    expect(resolveRedesignFlags({ cookbook: rule }, viewer).cookbook).toBe(false);
  });

  it('lets allow-listed users in at 0%', () => {
    const rule = { enabled: true, percent: 0, allowUserIds: ['user-1'] };
    expect(resolveRedesignFlags({ track: rule }, viewer).track).toBe(true);
    expect(resolveRedesignFlags({ track: rule }, { ...viewer, userId: 'other' }).track).toBe(false);
  });

  it('rolls out to roughly the requested share, stably per user', () => {
    const rule = { enabled: true, percent: 30, allowUserIds: [] };
    let count = 0;
    for (let i = 0; i < 2000; i++) {
      const id = `u${i}`;
      const flag = resolveRedesignFlags({ make: rule }, { ...viewer, userId: id }).make;
      expect(flag).toBe(resolveRedesignFlags({ make: rule }, { ...viewer, userId: id }).make);
      if (flag) count++;
    }
    expect(count).toBeGreaterThan(500);
    expect(count).toBeLessThan(700);
    expect(rolloutBucket('u1', 'make')).toBe(rolloutBucket('u1', 'make'));
  });

  it('respects the minimum app version, and treats unknown versions as old', () => {
    const rule = { ...on, minAppVersion: '4.2.0' };
    expect(resolveRedesignFlags({ kitchen: rule }, viewer).kitchen).toBe(false);
    expect(resolveRedesignFlags({ kitchen: rule }, { ...viewer, appVersion: '4.2.0' }).kitchen).toBe(true);
    expect(resolveRedesignFlags({ kitchen: rule }, { ...viewer, appVersion: null }).kitchen).toBe(false);
  });

  it('only allows entry and plans before sign-in, and only at 100%', () => {
    const anon = { userId: null, appVersion: '4.1.0' };
    const flags = resolveRedesignFlags(
      { entry: on, plans: on, cookbook: on, track: { ...on, percent: 50 } },
      anon,
    );
    expect(flags.entry).toBe(true);
    expect(flags.plans).toBe(true);
    expect(flags.cookbook).toBe(false);
    expect(
      resolveRedesignFlags({ entry: { ...on, percent: 99 } }, anon).entry,
    ).toBe(false);
  });

  it('keeps Home off until My Kitchen is on, and plans off until entry is on', () => {
    expect(resolveRedesignFlags({ home: on }, viewer).home).toBe(false);
    expect(resolveRedesignFlags({ home: on, kitchen: on }, viewer).home).toBe(true);
    expect(resolveRedesignFlags({ plans: on }, viewer).plans).toBe(false);
  });
});

describe('normaliseRules', () => {
  it('clamps, cleans and drops unknown areas', () => {
    const rules = normaliseRules({
      home: { enabled: true, percent: 250, allowUserIds: ['a', 3 as any, ''], minAppVersion: 'abc' },
      nonsense: { enabled: true, percent: 100 },
    } as any);
    expect(rules.home).toEqual({ enabled: true, percent: 100, allowUserIds: ['a'] });
    expect((rules as any).nonsense).toBeUndefined();
    expect(rules.track).toEqual({ enabled: false, percent: 0, allowUserIds: [] });
  });

  it('treats enabled as true only when it is literally true', () => {
    expect(normaliseRules({ home: { enabled: 'yes' as any, percent: 100 } }).home.enabled).toBe(false);
  });
});

describe('client version header', () => {
  it('reads a plain version and rejects anything else', () => {
    expect(getClientVersion({ 'x-app-version': '4.1.0' })).toBe('4.1.0');
    expect(getClientVersion({ 'x-app-version': ['4.2.1'] })).toBe('4.2.1');
    expect(getClientVersion({ 'x-app-version': 'latest' })).toBeNull();
    expect(getClientVersion({})).toBeNull();
    expect(getClientVersion(undefined)).toBeNull();
  });

  it('compares against a minimum, treating a missing header as old', () => {
    expect(clientAtLeast({ 'x-app-version': '4.2.0' }, '4.2.0')).toBe(true);
    expect(clientAtLeast({ 'x-app-version': '4.10.0' }, '4.2.0')).toBe(true);
    expect(clientAtLeast({ 'x-app-version': '4.1.9' }, '4.2.0')).toBe(false);
    expect(clientAtLeast({}, '4.2.0')).toBe(false);
  });
});
