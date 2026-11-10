import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Subscription, SubscriptionDocument } from '../../database/schemas/subscription.schema';
import {
  RevenueCatEvent,
  RevenueCatEventDocument,
} from '../../database/schemas/revenuecat-event.schema';
import {
  SubscriptionAnalyticsRun,
  SubscriptionAnalyticsRunDocument,
  SubscriptionDailyState,
  SubscriptionDailyStateDocument,
  SubscriptionPeriod,
  SubscriptionPeriodDocument,
  SubscriptionTransaction,
  SubscriptionTransactionDocument,
} from '../../database/schemas/subscription-analytics.schema';
// Type-only: scripts build this service without loading the full user schema.
import type { UserDocument } from '../../database/schemas/user.auth.schema';
import { TRIAL_DAYS } from '../subscription/subscription.constants';
import {
  BillingEvent,
  CompedGrant,
  DEFAULT_CONVERSION_WINDOW_DAYS,
  DailyStateRecord,
  HISTORY_BUILDER_VERSION,
  NormalizedTransaction,
  SubscriptionPeriodRecord,
  UserHistory,
  billingEventFromPayload,
  buildDailyStates,
  buildUserHistory,
  reconstructFromSubscriptionRow,
  transactionsFromRcApi,
  transactionsFromWebhookPayloads,
} from './history-builder';
import { dateKeyInTz, reportingTimezone } from './reporting-tz';
import { RevenueCatHistoryClient, RevenueCatHistoryNotFound } from './revenuecat-history.client';

export interface RebuildOptions {
  trigger: string;
  dryRun?: boolean;
  /** Skip RevenueCat API calls (webhook log + subscription rows only). */
  skipRevenueCat?: boolean;
  now?: Date;
  /** Dry runs only: return the computed rows in the summary. */
  includeData?: boolean;
}

export interface RebuildSummary {
  runId: string;
  dryRun: boolean;
  status: 'success' | 'failed';
  durationMs: number;
  settings: Record<string, unknown>;
  counts: Record<string, number>;
  quality: Record<string, unknown>;
  error?: string;
  data?: {
    periods: SubscriptionPeriodRecord[];
    transactions: NormalizedTransaction[];
    states: DailyStateRecord[];
  };
}

const KEEP_RUNS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

const isObjectIdString = (v: unknown): v is string => typeof v === 'string' && Types.ObjectId.isValid(v) && /^[a-f0-9]{24}$/i.test(v);

/** What the subscription row says the user has right now (for reconciliation). */
function rowCurrentState(row: any, now: Date): 'paid' | 'trial' | 'comped' | 'none' {
  if (!row || (row.plan !== 'hero' && row.plan !== 'legend')) return 'none';
  if (row.expiresAt && new Date(row.expiresAt) <= now) return 'none';
  if (String(row.store ?? '').toLowerCase() === 'manual') return 'comped';
  if (row.status === 'in_trial' || String(row.periodType ?? '').toLowerCase() === 'trial') return 'trial';
  if (['active', 'cancelled'].includes(String(row.status))) return 'paid';
  return 'none';
}

function derivedCurrentState(states: DailyStateRecord[], todayKey: string): 'paid' | 'trial' | 'comped' | 'none' {
  const today = states.find((s) => s.date === todayKey);
  if (!today) return 'none';
  if (today.state === 'paid' || today.state === 'paid_cancelling' || today.state === 'billing_issue') return 'paid';
  return today.state === 'trial' ? 'trial' : 'comped';
}

@Injectable()
export class SubscriptionAnalyticsService {
  private readonly logger = new Logger(SubscriptionAnalyticsService.name);

  constructor(
    @InjectModel(Subscription.name) private readonly subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(RevenueCatEvent.name) private readonly eventModel: Model<RevenueCatEventDocument>,
    @InjectModel('User') private readonly userModel: Model<UserDocument>,
    @InjectModel(SubscriptionPeriod.name) private readonly periodModel: Model<SubscriptionPeriodDocument>,
    @InjectModel(SubscriptionTransaction.name) private readonly transactionModel: Model<SubscriptionTransactionDocument>,
    @InjectModel(SubscriptionDailyState.name) private readonly stateModel: Model<SubscriptionDailyStateDocument>,
    @InjectModel(SubscriptionAnalyticsRun.name) private readonly runModel: Model<SubscriptionAnalyticsRunDocument>,
    private readonly configService: ConfigService,
  ) {}

  private setting(key: string): string | undefined {
    return this.configService.get<string>(key)?.trim() || undefined;
  }

  settings() {
    const usdToAud = Number(this.setting('SUBSCRIPTION_ANALYTICS_USD_AUD') ?? 1.53);
    const conversionWindowDays = Number(
      this.setting('SUBSCRIPTION_ANALYTICS_CONVERSION_WINDOW_DAYS') ?? DEFAULT_CONVERSION_WINDOW_DAYS,
    );
    return {
      builderVersion: HISTORY_BUILDER_VERSION,
      timezone: reportingTimezone(),
      historyStartDate: this.setting('SUBSCRIPTION_ANALYTICS_HISTORY_START') ?? '2026-04-01',
      usdToAud: Number.isFinite(usdToAud) && usdToAud > 0 ? usdToAud : 1.53,
      fxSource: 'RevenueCat USD amount × fixed rate (AUD charges used as-is)',
      conversionWindowDays: Number.isFinite(conversionWindowDays) ? conversionWindowDays : DEFAULT_CONVERSION_WINDOW_DAYS,
      trialDays: TRIAL_DAYS,
      webhookLogStartedAt: null as string | null,
    };
  }

  private revenueCatClient(): RevenueCatHistoryClient {
    return new RevenueCatHistoryClient({
      apiKey: this.setting('REVENUECAT_V2_API_KEY') ?? this.setting('REVENUECAT_SECRET_API_KEY'),
      projectId: this.setting('REVENUECAT_PROJECT_ID') ?? this.setting('REVENUECAT_V2_PROJECT_ID'),
    });
  }

  async rebuild(options: RebuildOptions): Promise<RebuildSummary> {
    const started = Date.now();
    const now = options.now ?? new Date();
    const runId = new Types.ObjectId().toHexString();
    const settings = this.settings();
    const dryRun = !!options.dryRun;

    if (!dryRun) {
      await this.runModel.create({
        runId,
        status: 'running',
        trigger: options.trigger,
        startedAt: new Date(started),
        settings,
      });
    }

    try {
      const result = await this.compute(now, settings, options);
      settings.webhookLogStartedAt = result.quality.webhookLogStartedAt as string | null;

      if (!dryRun) {
        await this.write(runId, result);
        await this.runModel.updateOne(
          { runId },
          {
            $set: {
              status: 'success',
              finishedAt: new Date(),
              durationMs: Date.now() - started,
              settings,
              counts: result.counts,
              quality: result.quality,
            },
          },
        );
        await this.prune(runId);
      }

      const summary: RebuildSummary = {
        runId,
        dryRun,
        status: 'success',
        durationMs: Date.now() - started,
        settings,
        counts: result.counts,
        quality: result.quality,
      };
      if (dryRun && options.includeData) {
        summary.data = { periods: result.periods, transactions: result.transactions, states: result.states };
      }
      this.logger.log(
        `Subscription analytics rebuilt run=${runId} dryRun=${dryRun} users=${result.counts.users} periods=${result.counts.periods} states=${result.counts.dailyStates} in ${summary.durationMs}ms`,
      );
      return summary;
    } catch (error: any) {
      this.logger.error(`Subscription analytics rebuild failed: ${error.message}`);
      if (!dryRun) {
        await this.runModel.updateOne(
          { runId },
          { $set: { status: 'failed', finishedAt: new Date(), durationMs: Date.now() - started, error: String(error.message ?? error) } },
        );
        // Drop any partial rows from this run; readers keep using the last good run.
        await Promise.all([
          this.periodModel.deleteMany({ runId }),
          this.transactionModel.deleteMany({ runId }),
          this.stateModel.deleteMany({ runId }),
        ]);
      }
      return {
        runId,
        dryRun,
        status: 'failed',
        durationMs: Date.now() - started,
        settings,
        counts: {},
        quality: {},
        error: String(error.message ?? error),
      };
    }
  }

  private async compute(
    now: Date,
    settings: ReturnType<SubscriptionAnalyticsService['settings']>,
    options: RebuildOptions,
  ) {
    const tz = settings.timezone;
    const todayKey = dateKeyInTz(now, tz);

    // ---- Webhook log ------------------------------------------------------
    const events = await this.eventModel
      .find({}, { eventId: 1, type: 1, appUserId: 1, originalAppUserId: 1, aliases: 1, environment: 1, payload: 1, receivedAt: 1, referralError: 1 })
      .lean();
    const productionEvents = events.filter((e) => String(e.environment ?? '').toUpperCase() === 'PRODUCTION');
    const eventsByUser = new Map<string, any[]>();
    let eventsWithoutUser = 0;
    for (const e of productionEvents) {
      const ids = [e.appUserId, e.originalAppUserId, ...(e.aliases ?? [])].filter(isObjectIdString);
      if (ids.length === 0) {
        eventsWithoutUser += 1;
        continue;
      }
      // Transfers name both sides; everything else belongs to app_user_id.
      const owners = e.type === 'TRANSFER' ? [] : [ids[0]];
      for (const id of owners) {
        const list = eventsByUser.get(id) ?? [];
        list.push(e);
        eventsByUser.set(id, list);
      }
    }

    // ---- Candidate users ---------------------------------------------------
    const rows = await this.subscriptionModel
      .find({
        $or: [
          { plan: { $in: ['hero', 'legend'] } },
          { purchasedAt: { $exists: true } },
          { 'trialsConsumed.hero': { $exists: true } },
          { 'trialsConsumed.legend': { $exists: true } },
          { lastEventId: { $exists: true } },
        ],
      })
      .lean();
    const rowByUser = new Map(rows.map((r) => [String(r.userId), r]));
    const userIds = Array.from(new Set([...rowByUser.keys(), ...eventsByUser.keys()])).filter(isObjectIdString);
    const users = await this.userModel
      .find({ _id: { $in: userIds.map((id) => new Types.ObjectId(id)) } }, { country: 1 })
      .lean();
    const countryByUser = new Map(users.map((u: any) => [String(u._id), u.country ?? null]));
    const missingUsers = userIds.filter((id) => !countryByUser.has(id));

    // ---- Per-user history --------------------------------------------------
    const client = this.revenueCatClient();
    const useRc = !options.skipRevenueCat && client.configured;
    const rc = { attempted: 0, ok: 0, notFound: 0, failed: 0 };
    const sourceCounts = { revenuecat_api: 0, webhook: 0, reconstructed: 0, none: 0 };
    const histories: UserHistory[] = [];
    const allStates: DailyStateRecord[] = [];
    const mismatches: Array<{ userId: string; subscriptionRow: string; derived: string }> = [];
    let skippedRcTransactions = 0;
    let missingPriceTransactions = 0;
    const seenTxKeys = new Map<string, string>();
    const duplicateTxKeys: string[] = [];

    const work = async (userId: string) => {
      const row = rowByUser.get(userId);
      const userEvents = eventsByUser.get(userId) ?? [];
      let transactions: NormalizedTransaction[] = [];
      let comped: CompedGrant[] = [];

      if (useRc) {
        rc.attempted += 1;
        try {
          const history = await client.fetchCustomerHistory(userId);
          const parsed = transactionsFromRcApi(userId, history, settings.usdToAud);
          transactions = parsed.transactions;
          comped = parsed.comped;
          skippedRcTransactions += parsed.skipped;
          rc.ok += 1;
        } catch (err) {
          if (err instanceof RevenueCatHistoryNotFound) rc.notFound += 1;
          else {
            rc.failed += 1;
            this.logger.warn(`RevenueCat history failed for a customer: ${(err as Error).message}`);
          }
        }
      }
      let source: keyof typeof sourceCounts = transactions.length ? 'revenuecat_api' : 'none';
      if (transactions.length === 0) {
        transactions = transactionsFromWebhookPayloads(userId, userEvents.map((e) => e.payload), settings.usdToAud);
        if (transactions.length) source = 'webhook';
      }
      if (row) {
        const rec = reconstructFromSubscriptionRow(userId, row as any, settings.trialDays);
        if (transactions.length === 0 && rec.transactions.some((t) => t.kind === 'paid')) {
          transactions = rec.transactions;
          source = 'reconstructed';
        } else {
          // Trials before the webhook log started are only known from trialsConsumed.
          for (const t of rec.transactions.filter((x) => x.kind === 'trial')) {
            const covered = transactions.some(
              (x) => x.kind === 'trial' && x.plan === t.plan && Math.abs(x.startAt.getTime() - t.startAt.getTime()) < 2 * DAY_MS,
            );
            const insidePaid = transactions.some((x) => x.kind === 'paid' && x.startAt <= t.startAt && x.endAt > t.startAt);
            if (!covered && !insidePaid) transactions.push(t);
          }
          if (source === 'none' && transactions.length) source = 'reconstructed';
        }
        if (comped.length === 0) comped = rec.comped;
      }
      if (source === 'none' && comped.length) source = 'reconstructed';
      sourceCounts[source] += 1;

      for (const t of transactions) {
        if (t.kind === 'paid' && t.aud.gross === null) missingPriceTransactions += 1;
        const owner = seenTxKeys.get(t.key);
        if (owner && owner !== userId) duplicateTxKeys.push(t.key);
        seenTxKeys.set(t.key, userId);
      }

      const billingEvents = userEvents
        .map((e) => billingEventFromPayload(e.eventId, e.payload))
        .filter((e): e is BillingEvent => !!e);
      const history = buildUserHistory({
        userId,
        transactions,
        comped,
        events: billingEvents,
        current: row
          ? {
              plan: row.plan,
              status: row.status,
              willRenew: row.willRenew,
              cancelledAt: row.cancelledAt ?? null,
              expiresAt: row.expiresAt ?? null,
            }
          : null,
        now,
        conversionWindowDays: settings.conversionWindowDays,
        country: countryByUser.get(userId) ?? null,
      });
      if (history.periods.length === 0) return;
      histories.push(history);
      const states = buildDailyStates(history, settings.historyStartDate, todayKey, tz, now);
      allStates.push(...states);

      const expected = rowCurrentState(row, now);
      const derived = derivedCurrentState(states, todayKey);
      if (row && expected !== derived) mismatches.push({ userId, subscriptionRow: expected, derived });
    };

    // Small pool keeps RevenueCat requests well under rate limits.
    const queue = [...userIds];
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (queue.length) {
          const id = queue.shift();
          if (id) await work(id);
        }
      }),
    );

    // RevenueCat transactions belong to one subscription, so a key seen under
    // two users points at a transfer problem: surfaced in Data Quality.
    const periods: SubscriptionPeriodRecord[] = histories.flatMap((h) => h.periods);
    const transactions: NormalizedTransaction[] = histories.flatMap((h) => h.transactions);

    const receivedTimes = events.map((e) => e.receivedAt).filter(Boolean).map((d) => new Date(d as Date).getTime());
    const thirtyDaysAgo = now.getTime() - 30 * DAY_MS;
    const eventTypesLast30d: Record<string, number> = {};
    for (const e of productionEvents) {
      if (e.receivedAt && new Date(e.receivedAt).getTime() >= thirtyDaysAgo) {
        const t = String(e.type ?? 'UNKNOWN');
        eventTypesLast30d[t] = (eventTypesLast30d[t] ?? 0) + 1;
      }
    }

    const counts = {
      users: histories.length,
      candidateUsers: userIds.length,
      periods: periods.length,
      transactions: transactions.length,
      dailyStates: allStates.length,
    };
    const quality = {
      webhookEventsTotal: events.length,
      webhookEventsProduction: productionEvents.length,
      webhookEventsSandboxExcluded: events.length - productionEvents.length,
      webhookEventsWithoutUser: eventsWithoutUser,
      webhookEventsFailedReferralProcessing: events.filter((e) => !!e.referralError).length,
      webhookLogStartedAt: receivedTimes.length ? new Date(Math.min(...receivedTimes)).toISOString() : null,
      lastWebhookReceivedAt: receivedTimes.length ? new Date(Math.max(...receivedTimes)).toISOString() : null,
      eventTypesLast30d,
      revenueCat: { enabled: useRc, ...rc },
      historySourceByUser: sourceCounts,
      skippedRevenueCatTransactions: skippedRcTransactions,
      paidTransactionsMissingPrice: missingPriceTransactions,
      duplicateTransactionOwners: duplicateTxKeys.length,
      usersWithoutAccount: missingUsers.length,
      reconciliation: {
        checkedUsers: rows.length,
        mismatches: mismatches.length,
        examples: mismatches.slice(0, 25),
      },
    };
    return { periods, transactions, states: allStates, counts, quality };
  }

  private async write(runId: string, result: { periods: SubscriptionPeriodRecord[]; transactions: NormalizedTransaction[]; states: DailyStateRecord[] }) {
    const oid = (id: string) => new Types.ObjectId(id);
    const chunk = async <T>(items: T[], fn: (batch: T[]) => Promise<unknown>) => {
      for (let i = 0; i < items.length; i += 1000) await fn(items.slice(i, i + 1000));
    };
    await chunk(result.periods, (b) =>
      this.periodModel.insertMany(b.map((p) => ({ ...p, runId, userId: oid(p.userId) })), { ordered: false }),
    );
    await chunk(result.transactions, (b) =>
      this.transactionModel.insertMany(b.map((t) => ({ ...t, runId, userId: oid(t.userId) })), { ordered: false }),
    );
    await chunk(result.states, (b) =>
      this.stateModel.insertMany(b.map((s) => ({ ...s, runId, userId: oid(s.userId) })), { ordered: false }),
    );
  }

  /** Deletes rows from older runs and keeps the last KEEP_RUNS run records. */
  private async prune(currentRunId: string) {
    await Promise.all([
      this.periodModel.deleteMany({ runId: { $ne: currentRunId } }),
      this.transactionModel.deleteMany({ runId: { $ne: currentRunId } }),
      this.stateModel.deleteMany({ runId: { $ne: currentRunId } }),
    ]);
    const old = await this.runModel.find({}, { runId: 1 }).sort({ startedAt: -1 }).skip(KEEP_RUNS).lean();
    if (old.length) await this.runModel.deleteMany({ runId: { $in: old.map((r) => r.runId) } });
  }
}
