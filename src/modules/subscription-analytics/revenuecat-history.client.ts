import { Logger } from '@nestjs/common';
import type { RcApiSubscription, RcApiTransaction } from './history-builder';

export class RevenueCatHistoryNotFound extends Error {}

export interface RevenueCatHistoryConfig {
  apiKey?: string;
  projectId?: string;
}

/**
 * Read-only RevenueCat API v2 client for subscription history:
 * a customer's subscriptions and each subscription's transactions.
 */
export class RevenueCatHistoryClient {
  private readonly logger = new Logger(RevenueCatHistoryClient.name);

  constructor(private readonly config: RevenueCatHistoryConfig) {}

  get configured(): boolean {
    return !!this.config.apiKey && !!this.config.projectId;
  }

  async fetchCustomerHistory(
    customerId: string,
  ): Promise<Array<{ subscription: RcApiSubscription; transactions: RcApiTransaction[] }>> {
    const pid = encodeURIComponent(this.config.projectId ?? '');
    const subscriptions = await this.list<RcApiSubscription>(
      `/projects/${pid}/customers/${encodeURIComponent(customerId)}/subscriptions?limit=100`,
    );
    const out: Array<{ subscription: RcApiSubscription; transactions: RcApiTransaction[] }> = [];
    for (const subscription of subscriptions) {
      const transactions = await this.list<RcApiTransaction>(
        `/projects/${pid}/subscriptions/${encodeURIComponent(subscription.id)}/transactions?limit=100`,
      );
      out.push({ subscription, transactions });
    }
    return out;
  }

  private async list<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    let next: string | undefined = path;
    for (let page = 0; next && page < 20; page += 1) {
      const data: any = await this.get(next);
      if (Array.isArray(data?.items)) items.push(...data.items);
      next = typeof data?.next_page === 'string' ? data.next_page : undefined;
    }
    return items;
  }

  private async get(pathOrUrl: string, attempt = 0): Promise<any> {
    const url = /^https?:\/\//i.test(pathOrUrl)
      ? pathOrUrl
      : `https://api.revenuecat.com/v2${pathOrUrl.startsWith('/v2/') ? pathOrUrl.slice(3) : pathOrUrl}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      if (res.status === 404) throw new RevenueCatHistoryNotFound();
      if (res.status === 429 && attempt < 4) {
        const retryAfter = Number(res.headers.get('retry-after')) || 2 ** attempt;
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        return this.get(pathOrUrl, attempt + 1);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`RevenueCat ${res.status}: ${body.slice(0, 200)}`);
      }
      return res.json();
    } finally {
      clearTimeout(timeout);
    }
  }
}
