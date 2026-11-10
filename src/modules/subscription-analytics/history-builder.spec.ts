import {
  BillingEvent,
  NormalizedTransaction,
  buildDailyStates,
  buildUserHistory,
  billingEventFromPayload,
  billingPeriodFor,
  planForProductId,
  reconstructFromSubscriptionRow,
  transactionsFromRcApi,
  transactionsFromWebhookPayloads,
} from './history-builder';
import { addDaysToKey, dateKeyInTz, endOfDayInTz, startOfDayInTz } from './reporting-tz';

const TZ = 'Australia/Melbourne';
const U = '6af2bf04d12d478a91c51700';
const d = (iso: string) => new Date(iso);
const DAY = 86_400_000;

function tx(partial: Partial<NormalizedTransaction> & { startAt: Date; endAt: Date }): NormalizedTransaction {
  const kind = partial.kind ?? 'paid';
  const gross = kind === 'trial' ? 0 : 14.99;
  return {
    key: partial.key ?? `rc:${partial.startAt.toISOString()}:${partial.plan ?? 'hero'}`,
    userId: U,
    productId: partial.productId ?? `saveful.${partial.plan ?? 'hero'}.monthly`,
    plan: partial.plan ?? 'hero',
    billingPeriod: partial.billingPeriod ?? 'monthly',
    store: partial.store ?? 'app_store',
    kind,
    effectiveEndAt: partial.effectiveEndAt ?? partial.endAt,
    currency: 'AUD',
    local: { gross, tax: kind === 'trial' ? 0 : 1.36, commission: kind === 'trial' ? 0 : 2.04, proceeds: kind === 'trial' ? 0 : 11.59 },
    usd: { gross: 0, tax: 0, commission: 0, proceeds: 0 },
    aud: partial.aud ?? { gross, tax: kind === 'trial' ? 0 : 1.36, commission: kind === 'trial' ? 0 : 2.04, proceeds: kind === 'trial' ? 0 : 11.59 },
    fxMethod: 'local_aud',
    refunded: false,
    source: partial.source ?? 'revenuecat_api',
    ...partial,
  } as NormalizedTransaction;
}

const ev = (type: string, at: string, extra: Partial<BillingEvent> = {}): BillingEvent => ({
  eventId: `${type}-${at}`,
  type,
  at: d(at),
  ...extra,
});

function statesOn(history: ReturnType<typeof buildUserHistory>, date: string) {
  return buildDailyStates(history, date, date, TZ);
}

describe('reporting timezone', () => {
  it('uses Melbourne calendar days', () => {
    // 2026-06-30T15:00Z is 1 July 01:00 in Melbourne (AEST, UTC+10).
    expect(dateKeyInTz(d('2026-06-30T15:00:00Z'), TZ)).toBe('2026-07-01');
    expect(startOfDayInTz('2026-07-01', TZ).toISOString()).toBe('2026-06-30T14:00:00.000Z');
    // Daylight saving (AEDT, UTC+11) in January.
    expect(endOfDayInTz('2026-01-15', TZ).toISOString()).toBe('2026-01-15T12:59:59.999Z');
    expect(addDaysToKey('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('product mapping', () => {
  it('maps iOS and Play product ids to plans and billing periods', () => {
    expect(planForProductId('saveful.hero.monthly')).toBe('hero');
    expect(planForProductId('saveful.legend:yearly')).toBe('legend');
    expect(planForProductId('something.else')).toBeNull();
    expect(billingPeriodFor('saveful.legend:yearly')).toBe('yearly');
    expect(billingPeriodFor('saveful.hero', d('2026-01-01'), d('2026-01-31'))).toBe('monthly');
  });
});

describe('buildUserHistory + daily states (acceptance criteria)', () => {
  const now = d('2026-11-10T00:00:00Z');

  it('a paid Hero user appears once, in the right plan, on the right days', () => {
    const h = buildUserHistory({
      userId: U,
      transactions: [
        tx({ startAt: d('2026-08-01T00:00:00Z'), endAt: d('2026-09-01T00:00:00Z') }),
        tx({ startAt: d('2026-09-01T00:00:00Z'), endAt: d('2026-10-01T00:00:00Z'), key: 'rc:2' }),
      ],
      comped: [],
      events: [],
      now,
    });
    expect(h.periods).toHaveLength(1);
    expect(h.periods[0].startReason).toBe('new');
    expect(h.periods[0].isFirstPaid).toBe(true);
    const rows = buildDailyStates(h, '2026-08-15', '2026-08-15', TZ);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'paid', plan: 'hero', mrrGrossAud: 14.99 });
    // Expired with no cancellation info → unknown churn reason, not guessed.
    expect(h.periods[0].endReason).toBe('unknown');
    expect(statesOn(h, '2026-10-05')).toHaveLength(0);
  });

  it('trial-only users never count as paid or add MRR', () => {
    const h = buildUserHistory({
      userId: U,
      transactions: [tx({ kind: 'trial', startAt: d('2026-09-01T00:00:00Z'), endAt: d('2026-09-08T00:00:00Z') })],
      comped: [],
      events: [],
      now,
    });
    const rows = statesOn(h, '2026-09-03');
    expect(rows[0].state).toBe('trial');
    expect(rows[0].mrrGrossAud).toBe(0);
    expect(h.firstPaidAt).toBeNull();
    expect(h.periods[0].endReason).toBe('trial_not_converted');
  });

  it('a trial still inside its conversion window is pending, not failed', () => {
    const h = buildUserHistory({
      userId: U,
      transactions: [tx({ kind: 'trial', startAt: d('2026-11-01T00:00:00Z'), endAt: d('2026-11-08T00:00:00Z') })],
      comped: [],
      events: [],
      now,
    });
    expect(h.periods[0].endReason).toBeNull();
  });

  it('trial converting to paid is labelled a conversion; direct paid works without a trial', () => {
    const converted = buildUserHistory({
      userId: U,
      transactions: [
        tx({ kind: 'trial', plan: 'legend', startAt: d('2026-09-01T00:00:00Z'), endAt: d('2026-09-08T00:00:00Z') }),
        tx({ plan: 'legend', startAt: d('2026-09-08T00:00:00Z'), endAt: d('2026-10-08T00:00:00Z'), key: 'rc:p' }),
      ],
      comped: [],
      events: [],
      now,
    });
    expect(converted.periods.map((p) => [p.kind, p.startReason, p.endReason])).toEqual([
      ['trial', 'new_trial', 'trial_converted'],
      ['paid', 'trial_conversion', 'unknown'],
    ]);
    const direct = buildUserHistory({
      userId: U,
      transactions: [tx({ startAt: d('2026-09-08T00:00:00Z'), endAt: d('2026-10-08T00:00:00Z') })],
      comped: [],
      events: [],
      now,
    });
    expect(direct.periods[0].startReason).toBe('new');
  });

  it('a cancellation request is not churn while paid access continues', () => {
    const h = buildUserHistory({
      userId: U,
      transactions: [tx({ startAt: d('2026-10-20T00:00:00Z'), endAt: d('2026-11-20T00:00:00Z') })],
      comped: [],
      events: [ev('CANCELLATION', '2026-11-01T00:00:00Z', { cancelReason: 'UNSUBSCRIBE' })],
      current: { status: 'cancelled', willRenew: false, cancelledAt: d('2026-11-01T00:00:00Z') },
      now,
    });
    expect(h.periods[0].isActive).toBe(true);
    expect(h.periods[0].endReason).toBeNull();
    expect(statesOn(h, '2026-10-25')[0].state).toBe('paid');
    expect(statesOn(h, '2026-11-05')[0].state).toBe('paid_cancelling');
  });

  it('voluntary vs involuntary churn after expiry', () => {
    const voluntary = buildUserHistory({
      userId: U,
      transactions: [tx({ startAt: d('2026-08-01T00:00:00Z'), endAt: d('2026-09-01T00:00:00Z') })],
      comped: [],
      events: [ev('CANCELLATION', '2026-08-10T00:00:00Z', { cancelReason: 'UNSUBSCRIBE' })],
      now,
    });
    expect(voluntary.periods[0].endReason).toBe('voluntary');

    // Before the webhook log: RevenueCat's auto-renew flag still tells us.
    const autoRenewOff = buildUserHistory({
      userId: U,
      transactions: [tx({ startAt: d('2026-05-01T00:00:00Z'), endAt: d('2026-06-01T00:00:00Z'), autoRenewalStatus: 'will_not_renew' })],
      comped: [],
      events: [],
      now,
    });
    expect(autoRenewOff.periods[0].endReason).toBe('voluntary');

    const involuntary = buildUserHistory({
      userId: U,
      transactions: [tx({ startAt: d('2026-08-01T00:00:00Z'), endAt: d('2026-09-01T00:00:00Z') })],
      comped: [],
      events: [ev('BILLING_ISSUE', '2026-09-01T01:00:00Z'), ev('EXPIRATION', '2026-09-10T00:00:00Z', { expirationReason: 'BILLING_ERROR' })],
      now,
    });
    expect(involuntary.periods[0].endReason).toBe('involuntary');
    // Billing-issue users are shown separately, not as paid.
    expect(statesOn(involuntary, '2026-09-05')[0].state).toBe('billing_issue');
    expect(statesOn(involuntary, '2026-09-05')[0].mrrGrossAud).toBeNull();
  });

  it('upgrade changes plan mix without changing the paid total, and is not churn', () => {
    const h = buildUserHistory({
      userId: U,
      transactions: [
        tx({ plan: 'hero', startAt: d('2026-08-01T00:00:00Z'), endAt: d('2026-09-01T00:00:00Z') }),
        tx({ plan: 'legend', productId: 'saveful.legend.monthly', startAt: d('2026-08-15T00:00:00Z'), endAt: d('2026-09-15T00:00:00Z'), key: 'rc:up' }),
      ],
      comped: [],
      events: [],
      now,
    });
    expect(h.periods.map((p) => [p.plan, p.startReason, p.endReason])).toEqual([
      ['hero', 'new', 'plan_change'],
      ['legend', 'upgrade', 'unknown'],
    ]);
    expect(statesOn(h, '2026-08-10').map((r) => r.plan)).toEqual(['hero']);
    expect(statesOn(h, '2026-08-20').map((r) => r.plan)).toEqual(['legend']);
  });

  it('monthly to yearly on the same plan is one continuous run', () => {
    const h = buildUserHistory({
      userId: U,
      transactions: [
        tx({ startAt: d('2026-05-01T00:00:00Z'), endAt: d('2026-06-01T00:00:00Z') }),
        tx({
          productId: 'saveful.hero.yearly',
          billingPeriod: 'yearly',
          startAt: d('2026-06-01T00:00:00Z'),
          endAt: d('2027-06-01T00:00:00Z'),
          key: 'rc:y',
          aud: { gross: 120, tax: 10.91, commission: 16.36, proceeds: 92.73 },
        }),
      ],
      comped: [],
      events: [],
      now,
    });
    expect(h.periods).toHaveLength(1);
    const row = statesOn(h, '2026-07-01')[0];
    expect(row.billingPeriod).toBe('yearly');
    expect(row.mrrGrossAud).toBe(10); // 120 / 12
  });

  it('reactivation after a lapse is labelled, not counted as a first purchase', () => {
    const h = buildUserHistory({
      userId: U,
      transactions: [
        tx({ startAt: d('2026-05-01T00:00:00Z'), endAt: d('2026-06-01T00:00:00Z') }),
        tx({ startAt: d('2026-08-01T00:00:00Z'), endAt: d('2026-09-01T00:00:00Z'), key: 'rc:back' }),
      ],
      comped: [],
      events: [],
      now,
    });
    expect(h.periods.map((p) => [p.startReason, p.isFirstPaid])).toEqual([
      ['new', true],
      ['reactivation', false],
    ]);
  });

  it('refunds end access and are labelled as refunds', () => {
    const h = buildUserHistory({
      userId: U,
      transactions: [tx({ key: 'rc:tx9', startAt: d('2026-08-01T00:00:00Z'), endAt: d('2026-09-01T00:00:00Z') })],
      comped: [],
      events: [ev('CANCELLATION', '2026-08-05T00:00:00Z', { cancelReason: 'CUSTOMER_SUPPORT', transactionId: 'tx9' })],
      now,
    });
    expect(h.transactions[0].refunded).toBe(true);
    expect(h.periods[0].endReason).toBe('refund');
    expect(statesOn(h, '2026-08-10')).toHaveLength(0);
  });

  it('today is evaluated as of now: access ending later today still counts', () => {
    const h = buildUserHistory({
      userId: U,
      transactions: [tx({ startAt: d('2026-10-10T09:00:00Z'), endAt: d('2026-11-10T09:00:00Z') })],
      comped: [],
      events: [],
      now: d('2026-11-10T02:00:00Z'), // 13:00 Melbourne, before the 20:00 expiry
    });
    expect(buildDailyStates(h, '2026-11-10', '2026-11-10', TZ, d('2026-11-10T02:00:00Z'))[0].state).toBe('paid');
    expect(buildDailyStates(h, '2026-11-10', '2026-11-10', TZ)).toHaveLength(0); // end of day: expired
  });

  it('comped grants never count as paid', () => {
    const h = buildUserHistory({
      userId: U,
      transactions: [],
      comped: [{ userId: U, plan: 'legend', startAt: d('2026-05-01T00:00:00Z'), endAt: d('2099-05-25T00:00:00Z'), source: 'reconstructed' }],
      events: [],
      now,
    });
    expect(statesOn(h, '2026-09-01')[0]).toMatchObject({ state: 'comped', mrrGrossAud: 0 });
    expect(h.firstPaidAt).toBeNull();
  });
});

describe('transaction sources', () => {
  it('duplicate and sandbox webhook events do not inflate transactions', () => {
    const purchase = {
      id: 'e1',
      type: 'INITIAL_PURCHASE',
      environment: 'PRODUCTION',
      product_id: 'saveful.hero.monthly',
      transaction_id: 't1',
      purchased_at_ms: Date.parse('2026-11-01T00:00:00Z'),
      expiration_at_ms: Date.parse('2026-12-01T00:00:00Z'),
      price: 9.5,
      price_in_purchased_currency: 14.99,
      currency: 'AUD',
      tax_percentage: 0.0909,
      commission_percentage: 0.15,
      period_type: 'NORMAL',
      store: 'APP_STORE',
    };
    const txs = transactionsFromWebhookPayloads(
      U,
      [purchase, { ...purchase, id: 'e1-retry' }, { ...purchase, id: 'sb', transaction_id: 'sb1', environment: 'SANDBOX' }],
      1.5,
    );
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ store: 'app_store', fxMethod: 'local_aud', kind: 'paid' });
    expect(txs[0].aud.gross).toBe(14.99);
    expect(txs[0].aud.tax).toBe(1.36);
    // 14.99 − 1.36 tax − 2.04 commission (15% of the ex-tax amount)
    expect(txs[0].aud.commission).toBe(2.04);
    expect(txs[0].aud.proceeds).toBe(11.59);
  });

  it('reads RevenueCat API transactions, skips sandbox, detects the trial, converts non-AUD via USD', () => {
    const { transactions, skipped } = transactionsFromRcApi(
      U,
      [
        {
          subscription: { id: 'sub1', store: 'play_store', environment: 'production', country: 'IN' },
          transactions: [
            {
              id: 'a',
              product_store_identifier: 'saveful.hero:yearly',
              purchased_at: Date.parse('2026-06-01T00:00:00Z'),
              expiration_date: Date.parse('2026-06-08T00:00:00Z'),
              revenue_in_local_currency: { currency: 'INR', gross: 0, tax: 0, commission: 0, proceeds: 0 },
              revenue_in_usd: { currency: 'USD', gross: 0, tax: 0, commission: 0, proceeds: 0 },
            },
            {
              id: 'b',
              product_store_identifier: 'saveful.hero:yearly',
              purchased_at: Date.parse('2026-06-08T00:00:00Z'),
              expiration_date: Date.parse('2027-06-08T00:00:00Z'),
              revenue_in_local_currency: { currency: 'INR', gross: 4999, tax: 762, commission: 635, proceeds: 3602 },
              revenue_in_usd: { currency: 'USD', gross: 60, tax: 9.15, commission: 7.62, proceeds: 43.23 },
            },
          ],
        },
        { subscription: { id: 'sub2', environment: 'sandbox' }, transactions: [{ id: 'z' }] },
      ],
      1.5,
    );
    expect(skipped).toBe(1);
    expect(transactions.map((t) => t.kind)).toEqual(['trial', 'paid']);
    expect(transactions[1]).toMatchObject({ fxMethod: 'usd_fixed_rate', billingPeriod: 'yearly', store: 'play_store' });
    expect(transactions[1].aud.gross).toBe(90);
  });

  it('reconstructs manual Legend grants as comped and trials from trialsConsumed', () => {
    const { transactions, comped } = reconstructFromSubscriptionRow(
      U,
      {
        plan: 'legend',
        productId: 'saveful.legend.yearly',
        store: 'manual',
        periodType: 'non_renewing',
        purchasedAt: d('2026-05-01T00:00:00Z'),
        expiresAt: d('2099-05-25T00:00:00Z'),
        trialsConsumed: { hero: d('2026-04-28T00:00:00Z') },
      },
      7,
    );
    expect(comped).toHaveLength(1);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ kind: 'trial', plan: 'hero', source: 'reconstructed' });
  });

  it('parses webhook payloads into builder events', () => {
    const e = billingEventFromPayload('x', { type: 'cancellation', event_timestamp_ms: 1, cancel_reason: 'UNSUBSCRIBE' });
    expect(e).toMatchObject({ type: 'CANCELLATION', cancelReason: 'UNSUBSCRIBE' });
    expect(billingEventFromPayload('y', { type: 'RENEWAL' })).toBeNull();
    expect(DAY).toBe(86_400_000);
  });
});
