import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { isPayable, ReferralPayoutService, sumByCurrency } from './referral-payout.service';
import { ReferralPayoutStatus } from '../../database/schemas/referral-payout.schema';
import { ReferralLedgerStatus } from '../../database/schemas/referral-ledger-entry.schema';

function chain(value: unknown) {
  const query: any = {
    select: () => query,
    lean: () => query,
    sort: () => query,
    then: (resolve: any, reject: any) => Promise.resolve(value).then(resolve, reject),
  };
  return query;
}

describe('payout helpers', () => {
  it('sums commission per currency', () => {
    expect(
      sumByCurrency([
        { currency: 'AUD', commissionMinor: 76 },
        { currency: 'AUD', commissionMinor: -76 },
        { currency: 'USD', commissionMinor: 50 },
        { currency: null, commissionMinor: null },
      ]),
    ).toEqual([
      { currency: 'AUD', commissionMinor: 0, entryCount: 2 },
      { currency: 'USD', commissionMinor: 50, entryCount: 1 },
      { currency: 'UNKNOWN', commissionMinor: 0, entryCount: 1 },
    ]);
  });

  it('pays only a positive net balance', () => {
    expect(isPayable([{ currency: 'AUD', commissionMinor: 76 }], 50)).toBe(true);
    expect(isPayable([{ currency: 'AUD', commissionMinor: 0 }], 0)).toBe(false);
    expect(isPayable([{ currency: 'AUD', commissionMinor: -76 }], -50)).toBe(false);
    // Mixed currencies: decided by the USD total.
    expect(
      isPayable(
        [
          { currency: 'AUD', commissionMinor: 300 },
          { currency: 'USD', commissionMinor: -100 },
        ],
        100,
      ),
    ).toBe(true);
    expect(
      isPayable(
        [
          { currency: 'AUD', commissionMinor: 100 },
          { currency: 'USD', commissionMinor: -300 },
        ],
        -200,
      ),
    ).toBe(false);
    // No USD known (e.g. manual adjustments): all lines must be non-negative.
    expect(isPayable([{ currency: 'AUD', commissionMinor: 500 }], 0)).toBe(true);
  });
});

describe('ReferralPayoutService', () => {
  const payoutId = new Types.ObjectId();
  const chefUserId = new Types.ObjectId();

  function setup(opts: { status: ReferralPayoutStatus; verified: boolean }) {
    const payout = {
      _id: payoutId,
      chefUserId,
      status: opts.status,
      toObject() {
        return { _id: payoutId, chefUserId, status: this.status };
      },
    };
    const payoutModel = {
      findById: jest.fn().mockResolvedValue(payout),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const entryModel = {
      find: jest.fn(() => chain([])),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 3 }),
    };
    const chefProfileModel = {
      findOne: jest.fn(() =>
        chain({ paymentDetails: { status: opts.verified ? 'verified' : 'pending' } }),
      ),
    };
    const service = new ReferralPayoutService(
      payoutModel as any,
      entryModel as any,
      chefProfileModel as any,
      {} as any,
      { queueChefReferralStatementEmail: jest.fn() } as any,
      { get: jest.fn() } as any,
    );
    return { service, payoutModel, entryModel };
  }

  it('refuses to approve until payment details are verified, and puts the payout on hold', async () => {
    const { service, payoutModel } = setup({ status: ReferralPayoutStatus.DRAFT, verified: false });
    await expect(service.approve(payoutId.toHexString(), new Types.ObjectId().toHexString())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(payoutModel.updateOne).toHaveBeenCalledWith(
      { _id: payoutId },
      { $set: { status: ReferralPayoutStatus.ON_HOLD, holdReason: 'payment_details_not_verified' } },
    );
  });

  it('only marks approved payouts as paid', async () => {
    const { service } = setup({ status: ReferralPayoutStatus.DRAFT, verified: true });
    await expect(
      service.markPaid(
        payoutId.toHexString(),
        { paidAmountMinor: 1000, paidCurrency: 'AUD', paymentReference: 'REF1' },
        new Types.ObjectId().toHexString(),
      ),
    ).rejects.toThrow('Only approved payouts can be marked paid');
  });

  it('voiding returns its entries to pending so they roll into a later payout', async () => {
    const { service, entryModel, payoutModel } = setup({
      status: ReferralPayoutStatus.APPROVED,
      verified: true,
    });
    await service.void(payoutId.toHexString(), 'wrong amounts', new Types.ObjectId().toHexString());

    expect(payoutModel.updateOne.mock.calls[0][1]).toMatchObject({
      $set: { status: ReferralPayoutStatus.VOID, voidReason: 'wrong amounts' },
      $unset: { activeKey: '' },
    });
    expect(entryModel.updateMany).toHaveBeenCalledWith(
      { payoutId, status: ReferralLedgerStatus.IN_PAYOUT },
      { $set: { status: ReferralLedgerStatus.PENDING, payoutId: null } },
    );
  });

  it('cannot void a paid payout', async () => {
    const { service } = setup({ status: ReferralPayoutStatus.PAID, verified: true });
    await expect(
      service.void(payoutId.toHexString(), 'oops', new Types.ObjectId().toHexString()),
    ).rejects.toThrow('Cannot void a paid payout');
  });

  it('only generates payouts for quarters that have ended', async () => {
    const { service } = setup({ status: ReferralPayoutStatus.DRAFT, verified: true });
    await expect(service.generate('2999-Q1', new Types.ObjectId().toHexString())).rejects.toThrow(
      'has not ended yet',
    );
    await expect(service.generate('Q1', new Types.ObjectId().toHexString())).rejects.toThrow(
      'quarter must look like',
    );
  });
});
