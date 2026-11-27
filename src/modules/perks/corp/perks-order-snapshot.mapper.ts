import { mapOrder } from './perks-corp.mapper';

/** A card's place in WeMAD's category tree. */
export interface SnapshotCardCategory {
  category: string;
  categoryName: string;
  categoryGroup: string;
  categoryGroupName: string;
}

export interface OrderSnapshotLine {
  lineId: string;
  ecardId: string;
  ecardName: string;
  faceValueCents: number;
  purchasePriceCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  status: string;
  purchaseType: string;
  category: string | null;
  categoryName: string | null;
  categoryGroup: string | null;
  categoryGroupName: string | null;
  perksCategory: string | null;
}

export interface OrderSnapshot {
  orderKey: string;
  orderReference: string | null;
  orderNumber: string | null;
  status: string;
  paymentStatus: string | null;
  currency: string;
  orderedAt: Date | null;
  faceValueCents: number;
  purchasePriceCents: number;
  savingsCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  cashbackCents: number;
  lines: OrderSnapshotLine[];
}

const cents = (dollars: number | null | undefined) =>
  Math.round((Number.isFinite(dollars) ? (dollars as number) : 0) * 100);

const parseDate = (value: string | null): Date | null => {
  if (!value) return null;
  // WeMAD sends "YYYY-MM-DD HH:mm:ss" as well as ISO; both parse once the space is a T.
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * One raw WeMAD order → the reporting snapshot we store.
 *
 * Amounts reuse `mapOrder`, so the figures match what the member sees in the
 * app. Categories come from `categories` (card id → WeMAD category) and are
 * matched to our own Perks category with `resolvePerksCategory`.
 */
export function toOrderSnapshot(
  raw: Record<string, unknown>,
  categories: Map<string, SnapshotCardCategory>,
  resolvePerksCategory: (...candidates: Array<string | null | undefined>) => string | null,
): OrderSnapshot | null {
  const order = mapOrder(raw);
  const orderKey =
    order.orderReference || order.orderNumber || String(raw.id ?? '');
  if (!orderKey) return null;

  const lines = order.lines.map((line): OrderSnapshotLine => {
    const found = categories.get(String(line.ecardId)) ?? null;
    return {
      lineId: line.lineId,
      ecardId: line.ecardId,
      ecardName: line.ecardName,
      faceValueCents: cents(line.faceValue),
      purchasePriceCents: cents(line.purchasePrice),
      discountCents: cents(line.discount),
      deliveryFeeCents: cents(line.deliveryFee),
      totalCents: cents(line.total),
      status: line.status,
      purchaseType: line.purchaseType,
      category: found?.category ?? null,
      categoryName: found?.categoryName ?? null,
      categoryGroup: found?.categoryGroup ?? null,
      categoryGroupName: found?.categoryGroupName ?? null,
      perksCategory: found
        ? resolvePerksCategory(
            found.category,
            found.categoryGroup,
            found.categoryName,
            found.categoryGroupName,
          )
        : null,
    };
  });

  // Order-level totals, falling back to the sum of lines when WeMAD omits them.
  const sum = (pick: (l: OrderSnapshotLine) => number) =>
    lines.reduce((acc, l) => acc + pick(l), 0);
  const faceValueCents = cents(order.totals.faceValue) || sum((l) => l.faceValueCents);
  const purchasePriceCents =
    cents(order.totals.purchasePrice) || sum((l) => l.purchasePriceCents);
  const totalCents = cents(order.totals.total) || sum((l) => l.totalCents);

  return {
    orderKey,
    orderReference: order.orderReference || null,
    orderNumber: order.orderNumber || null,
    status: order.status,
    paymentStatus: order.payment.status,
    currency: order.currency || 'AUD',
    orderedAt: parseDate(order.createdAt),
    faceValueCents,
    purchasePriceCents,
    savingsCents: cents(order.totals.savings) || sum((l) => l.discountCents),
    deliveryFeeCents: cents(order.totals.deliveryFee) || sum((l) => l.deliveryFeeCents),
    totalCents,
    cashbackCents: cents(order.totals.cashback),
    lines,
  };
}
