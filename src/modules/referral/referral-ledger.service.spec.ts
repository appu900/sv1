import { Types } from 'mongoose';
import { ReferralLedgerService } from './referral-ledger.service';
import {
  ReferralLedgerStatus,
  ReferralLedgerType,
} from '../../database/schemas/referral-ledger-entry.schema';
import { ReferralHoldReason } from './referral.constants';

// ---------------------------------------------------------------------------
// Minimal in-memory stand-in for the Mongoose model calls the ledger makes,
// including unique indexes, so idempotency is exercised for real.
// ---------------------------------------------------------------------------

function norm(value: any): any {
  if (value instanceof Types.ObjectId) return value.toHexString();
  if (value instanceof Date) return value.getTime();
  return value ?? null;
}

function matches(doc: any, query: Record<string, any>): boolean {
  return Object.entries(query).every(([key, cond]) => {
    const actual = norm(doc[key]);
    if (
      cond &&
      typeof cond === 'object' &&
      !(cond instanceof Types.ObjectId) &&
      !(cond instanceof Date) &&
      Object.keys(cond).some((k) => k.startsWith('$'))
    ) {
      return Object.entries(cond).every(([op, value]: [string, any]) => {
        switch (op) {
          case '$in':
            return value.map(norm).includes(actual);
          case '$ne':
            return actual !== norm(value);
          case '$lt':
            return actual !== null && actual < norm(value);
          case '$lte':
            return actual !== null && actual <= norm(value);
          case '$gte':
            return actual !== null && actual >= norm(value);
          case '$type':
            return typeof doc[key] === value;
          default:
            throw new Error(`unsupported operator ${op}`);
        }
      });
    }
    return actual === norm(cond);
  });
}

class FakeQuery {
  private sortSpec: Record<string, 1 | -1> | null = null;
  private limitN: number | null = null;
  constructor(
    private readonly rows: () => any[],
    private readonly single: boolean,
  ) {}
  sort(spec: Record<string, 1 | -1>) {
    this.sortSpec = spec;
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  skip() {
    return this;
  }
  select() {
    return this;
  }
  lean() {
    return this;
  }
  then(resolve: (v: any) => any, reject?: (e: any) => any) {
    let rows = [...this.rows()];
    if (this.sortSpec) {
      const spec = Object.entries(this.sortSpec);
      rows.sort((a, b) => {
        for (const [key, dir] of spec) {
          const av = norm(a[key]);
          const bv = norm(b[key]);
          if (av < bv) return -dir;
          if (av > bv) return dir;
        }
        return 0;
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    return Promise.resolve(this.single ? (rows[0] ?? null) : rows).then(resolve, reject);
  }
}

class FakeModel {
  docs: any[] = [];
  private clock = 0;
  constructor(private readonly uniqueKeys: string[] = []) {}

  async create(input: any) {
    const doc = {
      _id: new Types.ObjectId(),
      ...input,
      createdAt: new Date(Date.UTC(2026, 0, 1) + ++this.clock),
    };
    for (const key of this.uniqueKeys) {
      if (typeof doc[key] !== 'string') continue;
      if (this.docs.some((d) => d[key] === doc[key])) {
        throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
      }
    }
    Object.defineProperty(doc, 'toObject', { value: () => ({ ...doc }) });
    this.docs.push(doc);
    return doc;
  }
  findOne(query: Record<string, any>) {
    return new FakeQuery(() => this.docs.filter((d) => matches(d, query)), true);
  }
  findById(id: any) {
    return new FakeQuery(() => this.docs.filter((d) => norm(d._id) === norm(id)), true);
  }
  find(query: Record<string, any>) {
    return new FakeQuery(() => this.docs.filter((d) => matches(d, query)), false);
  }
  private apply(doc: any, update: any) {
    Object.assign(doc, update.$set ?? {});
    for (const [key, n] of Object.entries(update.$inc ?? {})) {
      doc[key] = (doc[key] ?? 0) + (n as number);
    }
  }
  async updateOne(filter: Record<string, any>, update: any) {
    const doc = this.docs.find((d) => matches(d, filter));
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    this.apply(doc, update);
    return { matchedCount: 1, modifiedCount: 1 };
  }
  async countDocuments(query: Record<string, any>) {
    return this.docs.filter((d) => matches(d, query)).length;
  }
}

// ---------------------------------------------------------------------------

const chefUserId = new Types.ObjectId();
const subscriberUserId = new Types.ObjectId();
let eventSeq = 0;

function rcEvent(overrides: Record<string, unknown> = {}) {
  eventSeq += 1;
  return {
    id: `evt_${eventSeq}`,
    type: 'RENEWAL',
    app_user_id: subscriberUserId.toHexString(),
    original_app_user_id: subscriberUserId.toHexString(),
    aliases: [subscriberUserId.toHexString()],
    transaction_id: `tx_${eventSeq}`,
    original_transaction_id: 'otx_1',
    period_type: 'NORMAL',
    price: 6.5,
    price_in_purchased_currency: 9.99,
    currency: 'AUD',
    tax_percentage: 0.0909,
    commission_percentage: 0.15,
    environment: 'PRODUCTION',
    store: 'APP_STORE',
    product_id: 'saveful.hero.monthly',
    renewal_number: 2,
    purchased_at_ms: Date.parse('2026-10-05T00:00:00Z'),
    event_timestamp_ms: Date.parse('2026-10-05T00:00:05Z'),
    ...overrides,
  };
}

function setup() {
  const eventModel = new FakeModel(['eventId']);
  const entryModel = new FakeModel(['dedupeKey', 'rcEventId']);
  const attribution = {
    _id: new Types.ObjectId(),
    chefUserId,
    subscriberUserId,
    commissionRateBps: 1000,
    firstPaidAt: null,
  };
  const attributionService = {
    findForEvent: jest.fn().mockResolvedValue(attribution),
    recordTrialStart: jest.fn(),
    recordPayment: jest.fn(),
    recordLapse: jest.fn(),
    recordReactivation: jest.fn(),
  };
  const service = new ReferralLedgerService(
    eventModel as any,
    entryModel as any,
    attributionService as any,
  );
  const deliver = async (event: any) => {
    const logged = await service.recordEvent({ event });
    if (logged) await service.processEvent(logged as any);
  };
  const earnings = () => entryModel.docs.filter((d) => d.type === ReferralLedgerType.EARNING);
  const reversals = () => entryModel.docs.filter((d) => d.type === ReferralLedgerType.REVERSAL);
  return { service, eventModel, entryModel, attributionService, deliver, earnings, reversals };
}

describe('ReferralLedgerService', () => {
  beforeEach(() => {
    eventSeq = 0;
  });

  it('turns a paid renewal into a pending earning of 10% of net', async () => {
    const { deliver, earnings, attributionService } = setup();
    await deliver(rcEvent());

    expect(earnings()).toHaveLength(1);
    expect(earnings()[0]).toMatchObject({
      status: ReferralLedgerStatus.PENDING,
      chefUserId,
      currency: 'AUD',
      grossMinor: 999,
      netMinor: 758,
      commissionMinor: 76,
      environment: 'PRODUCTION',
      transactionId: 'tx_1',
    });
    expect(attributionService.recordPayment).toHaveBeenCalledTimes(1);
  });

  it('ignores a retried webhook with the same event id', async () => {
    const { deliver, earnings, eventModel } = setup();
    const event = rcEvent();
    await deliver(event);
    await deliver(event);

    expect(eventModel.docs).toHaveLength(1);
    expect(earnings()).toHaveLength(1);
  });

  it('never pays twice for one store transaction, even across event ids', async () => {
    const { deliver, earnings } = setup();
    await deliver(rcEvent({ transaction_id: 'tx_same' }));
    await deliver(rcEvent({ transaction_id: 'tx_same' }));
    expect(earnings()).toHaveLength(1);
  });

  it('records a renewal that arrives after a newer one', async () => {
    const { deliver, earnings } = setup();
    await deliver(rcEvent({ purchased_at_ms: Date.parse('2026-12-05T00:00:00Z') }));
    await deliver(rcEvent({ purchased_at_ms: Date.parse('2026-11-05T00:00:00Z') }));
    expect(earnings()).toHaveLength(2);
  });

  it('creates no earning for a free trial start', async () => {
    const { deliver, entryModel, attributionService } = setup();
    await deliver(rcEvent({ type: 'INITIAL_PURCHASE', period_type: 'TRIAL', price: 0, price_in_purchased_currency: 0 }));
    expect(entryModel.docs).toHaveLength(0);
    expect(attributionService.recordTrialStart).toHaveBeenCalledTimes(1);
  });

  it('holds an earning when RevenueCat omits financial fields', async () => {
    const { deliver, earnings } = setup();
    await deliver(rcEvent({ tax_percentage: null }));
    expect(earnings()[0]).toMatchObject({
      status: ReferralLedgerStatus.HELD,
      holdReason: ReferralHoldReason.MISSING_TAX,
      commissionMinor: null,
    });
  });

  it('flags sandbox purchases', async () => {
    const { deliver, earnings } = setup();
    await deliver(rcEvent({ environment: 'SANDBOX' }));
    expect(earnings()[0].environment).toBe('SANDBOX');
  });

  it('does nothing for customers without a referral', async () => {
    const { deliver, entryModel, attributionService } = setup();
    attributionService.findForEvent.mockResolvedValue(null);
    await deliver(rcEvent());
    expect(entryModel.docs).toHaveLength(0);
  });

  describe('refunds', () => {
    const refundOf = (transactionId: string) =>
      rcEvent({
        type: 'CANCELLATION',
        cancel_reason: 'CUSTOMER_SUPPORT',
        transaction_id: transactionId,
        price: -6.5,
        price_in_purchased_currency: -9.99,
      });

    it('cancels an unpaid earning (net zero, kept for audit)', async () => {
      const { deliver, earnings, reversals } = setup();
      await deliver(rcEvent({ transaction_id: 'tx_paid' }));
      await deliver(refundOf('tx_paid'));

      expect(earnings()[0].status).toBe(ReferralLedgerStatus.REVERSED);
      expect(reversals()).toHaveLength(1);
      expect(reversals()[0]).toMatchObject({
        status: ReferralLedgerStatus.REVERSED,
        commissionMinor: -76,
        reversesEntryId: earnings()[0]._id,
      });
    });

    it('claws back an already-paid earning from the next payout', async () => {
      const { deliver, earnings, reversals } = setup();
      await deliver(rcEvent({ transaction_id: 'tx_paid' }));
      earnings()[0].status = ReferralLedgerStatus.PAID;
      await deliver(refundOf('tx_paid'));

      expect(earnings()[0].status).toBe(ReferralLedgerStatus.PAID);
      expect(reversals()[0]).toMatchObject({
        status: ReferralLedgerStatus.PENDING,
        commissionMinor: -76,
        currency: 'AUD',
      });
    });

    it('reverses a commission only once', async () => {
      const { deliver, reversals, earnings } = setup();
      await deliver(rcEvent({ transaction_id: 'tx_paid' }));
      earnings()[0].status = ReferralLedgerStatus.PAID;
      await deliver(refundOf('tx_paid'));
      await deliver(refundOf('tx_paid'));
      expect(reversals()).toHaveLength(1);
    });

    it('ignores refunds of payments that earned nothing', async () => {
      const { deliver, entryModel } = setup();
      await deliver(refundOf('tx_unknown'));
      expect(entryModel.docs).toHaveLength(0);
    });

    it('earns the commission again when the store reverses the refund', async () => {
      const { deliver, earnings } = setup();
      await deliver(rcEvent({ transaction_id: 'tx_paid' }));
      await deliver(refundOf('tx_paid'));
      await deliver(rcEvent({ type: 'REFUND_REVERSED', transaction_id: 'tx_paid' }));

      const live = earnings().filter((e) => e.status === ReferralLedgerStatus.PENDING);
      expect(live).toHaveLength(1);
      expect(live[0]).toMatchObject({ commissionMinor: 76, transactionId: 'tx_paid', payoutId: null });
    });
  });

  it('marks lapses and reactivations on the attribution only', async () => {
    const { deliver, entryModel, attributionService } = setup();
    await deliver(rcEvent({ type: 'EXPIRATION' }));
    await deliver(rcEvent({ type: 'UNCANCELLATION' }));
    expect(attributionService.recordLapse).toHaveBeenCalledTimes(1);
    expect(attributionService.recordReactivation).toHaveBeenCalledTimes(1);
    expect(entryModel.docs).toHaveLength(0);
  });

  it('keeps a failed event for the retry cron, which applies it later', async () => {
    const { service, deliver, eventModel, earnings, attributionService } = setup();
    attributionService.findForEvent.mockRejectedValueOnce(new Error('db blip'));
    await deliver(rcEvent());

    // The fake applies no schema defaults, so "unprocessed" shows as undefined.
    expect(eventModel.docs[0].referralProcessedAt ?? null).toBeNull();
    expect(eventModel.docs[0]).toMatchObject({ referralError: 'db blip', attempts: 1 });
    expect(earnings()).toHaveLength(0);

    eventModel.docs[0].receivedAt = new Date(Date.now() - 5 * 60_000);
    await expect(service.processPending()).resolves.toBe(1);
    expect(earnings()).toHaveLength(1);
    expect(eventModel.docs[0].referralProcessedAt).toBeInstanceOf(Date);
  });
});
