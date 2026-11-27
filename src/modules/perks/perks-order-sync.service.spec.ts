import { ForbiddenException } from '@nestjs/common';
import { PerksOrderSyncService } from './perks-order-sync.service';

function setup(overrides: { lock?: boolean; members?: string[]; sync?: jest.Mock } = {}) {
  const store = new Map<string, unknown>();
  const redis = {
    setIfAbsent: jest.fn().mockResolvedValue(overrides.lock ?? true),
    releaseLock: jest.fn().mockResolvedValue(true),
    set: jest.fn(async (k: string, v: unknown) => {
      store.set(k, JSON.parse(JSON.stringify(v)));
    }),
    get: jest.fn(async (k: string) => store.get(k) ?? null),
  };
  const perks = {
    listSyncableMemberIds: jest.fn().mockResolvedValue(overrides.members ?? ['a', 'b', 'c']),
    syncMemberOrders:
      overrides.sync ??
      jest
        .fn()
        .mockResolvedValueOnce({ status: 'synced', orders: 2 })
        .mockResolvedValueOnce({ status: 'skipped', orders: 0, reason: 'PERKS_PAYMENT_REQUIRED' })
        .mockRejectedValueOnce(new Error('wemad timeout')),
  };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const service = new PerksOrderSyncService(perks as never, redis as never, config as never);
  return { service, perks, redis };
}

describe('PerksOrderSyncService', () => {
  it('syncs members one by one and counts each outcome', async () => {
    const { service, redis } = setup();
    const summary = await service.syncAll('admin');
    expect(summary).toMatchObject({
      status: 'success',
      members: 3,
      synced: 1,
      skipped: 1,
      failed: 1,
      orders: 2,
    });
    expect(redis.releaseLock).toHaveBeenCalled();
    expect(await service.lastSummary()).toMatchObject({ status: 'success', orders: 2 });
  });

  it('does nothing while another run holds the lock', async () => {
    const { service, perks } = setup({ lock: false });
    expect(await service.syncAll('cron')).toBeNull();
    expect(perks.listSyncableMemberIds).not.toHaveBeenCalled();
  });

  it('can be switched off for the cron only', async () => {
    const { service, perks } = setup();
    (service as unknown as { config: { get: jest.Mock } }).config.get.mockReturnValue('false');
    await service.scheduledSync();
    expect(perks.listSyncableMemberIds).not.toHaveBeenCalled();
  });

  it('records a failed run and still releases the lock', async () => {
    const { service, perks, redis } = setup();
    perks.listSyncableMemberIds.mockRejectedValue(new ForbiddenException('nope'));
    const summary = await service.syncAll('cron');
    expect(summary?.status).toBe('failed');
    expect(redis.releaseLock).toHaveBeenCalled();
  });
});
