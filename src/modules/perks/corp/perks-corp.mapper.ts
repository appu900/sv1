import { createHash } from 'crypto';

const CARD_IMAGE_BASE = 'https://sandbox.wemad.com.au/storage';

export interface CatalogueCard {
  id: string;
  name: string;
  category: string | null;
  discountPercent: number;
  imageFilename: string | null;
  imageUrl: string | null;
  priceType: string;
  availableValues: number[];
  /** True when availableValues are a suggested ladder, not fixed denominations. */
  variablePrice: boolean;
  minAmount: number | null;
  maxAmount: number | null;
  balanceLink: string | null;
  description: string | null;
  terms: string | null;
  deliveryFee: number;
  featured: boolean;
}

export const str = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value);

export const nullableStr = (value: unknown): string | null => {
  const result = str(value).trim();
  return !result || result.toLowerCase() === 'null' ? null : result;
};

export const num = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const arr = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object',
      )
    : [];


export const DEFAULT_DISCOUNT_TIER = 'per_gold';

function siteAware(
  card: Record<string, unknown>,
  field: string,
): number | null {
  const siteOverride = arr(card.site_gift_cards)[0];
  const fromSite = siteOverride ? num(siteOverride[field]) : null;
  return fromSite !== null ? fromSite : num(card[field]);
}

export function resolveDiscountPercent(
  card: Record<string, unknown>,
  tier = DEFAULT_DISCOUNT_TIER,
): number {
  return siteAware(card, tier) ?? 0;
}

export function resolveDeliveryFee(card: Record<string, unknown>): number {
  return siteAware(card, 'delivery_fee') ?? 0;
}

export function resolveImageUrl(value: unknown): string | null {
  const path = nullableStr(value);
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  if (path.includes('..')) return null;
  return `${CARD_IMAGE_BASE}/${path.replace(/^\/+/, '')}`;
}

export function resolveAvailableValues(
  card: Record<string, unknown>,
): number[] {
  const providerProduct = card.provider_product as
    | Record<string, unknown>
    | undefined;
  const denominations = arr(providerProduct?.available_denominations);
  return denominations
    .map((item) => num(item.amount))
    .filter((value): value is number => value !== null && value > 0)
    .sort((left, right) => left - right);
}

/** Amounts offered when a card has no fixed denominations. */
const LADDER = [10, 20, 25, 50, 75, 100, 150, 200, 250, 300, 500, 1000];
const DEFAULT_MIN = 10;
const DEFAULT_MAX = 500;

/**
 * Most sandbox cards expose no denominations at all, and the ones marked
 * `variable` give only min/max — yet WeMAD's cart accepts ANY amount without
 * validating it (confirmed live: a $100-max card accepted $999, and a
 * fixed-denomination card accepted an off-denomination $77). So we build a
 * usable ladder here and enforce the bounds ourselves; upstream will not.
 */
export function resolvePricing(card: Record<string, unknown>): {
  priceType: string;
  availableValues: number[];
  variablePrice: boolean;
  minAmount: number | null;
  maxAmount: number | null;
} {
  const providerProduct =
    (card.provider_product as Record<string, unknown> | undefined) ?? {};
  const fixed = resolveAvailableValues(card);
  const priceType = str(providerProduct.price_type);

  if (fixed.length > 0) {
    return {
      priceType: priceType || 'fixed',
      availableValues: fixed,
      variablePrice: false,
      minAmount: fixed[0],
      maxAmount: fixed[fixed.length - 1],
    };
  }

  const min = num(providerProduct.min_amount) ?? DEFAULT_MIN;
  const max = num(providerProduct.max_amount) ?? DEFAULT_MAX;
  const bounded = LADDER.filter((value) => value >= min && value <= max);
  // Always offer the exact bounds so the extremes stay reachable.
  const values = Array.from(new Set([min, ...bounded, max]))
    .filter((value) => value > 0)
    .sort((left, right) => left - right);

  return {
    priceType: priceType || 'variable',
    availableValues: values,
    variablePrice: true,
    minAmount: min,
    maxAmount: max,
  };
}

export function resolveCategory(card: Record<string, unknown>): string | null {
  const categories = arr(card.categories);
  if (!categories.length) return null;
  const leaf =
    categories.find((category) => category.parent_id !== null) ?? categories[0];
  return nullableStr(leaf.slug) ?? nullableStr(leaf.name);
}

export function mapCatalogueCard(
  card: Record<string, unknown>,
  tier?: string,
): CatalogueCard {
  const discountPercent = resolveDiscountPercent(card, tier);
  const isPopular = num(card.is_popular) ?? 0;
  const pricing = resolvePricing(card);
  return {
    id: str(card.id),
    name: str(card.name).trim(),
    category: resolveCategory(card),
    discountPercent,
    imageFilename: nullableStr(card.image),
    imageUrl: resolveImageUrl(card.image),
    priceType: pricing.priceType,
    availableValues: pricing.availableValues,
    variablePrice: pricing.variablePrice,
    minAmount: pricing.minAmount,
    maxAmount: pricing.maxAmount,
    balanceLink: nullableStr(card.balance_link),
    description: nullableStr(card.description),
    terms: nullableStr(card.term),
    deliveryFee: resolveDeliveryFee(card),
    featured: isPopular === 1 || discountPercent >= 5,
  };
}

export function mapGiftTemplates(detail: Record<string, unknown>) {
  return arr(detail.gift_templates).map((template) => ({
    id: str(template.id),
    name: str(template.template_name),
    subject: str(template.template_subject),
    designs: arr(template.designs).map((design) => ({
      id: str(design.id),
      name: str(design.name),
      thumbnailUrl: resolveImageUrl(design.thumbnail),
      imageUrl: resolveImageUrl(design.image),
    })),
  }));
}


export function mapOrderStatus(value: unknown): string {
  switch (str(value).toLowerCase()) {
    case 'completed':
    case 'complete':
    case 'sent':
      return 'completed';
    case 'processing':
    case 'pending':
      return 'processing';
    case 'refunded':
    case 'cancelled':
    case 'canceled':
      return 'refunded';
    case 'failed':
      return 'failed';
    default:
      return 'unknown';
  }
}

const toCents = (value: unknown): number =>
  Math.round((num(value) ?? 0) * 100);

export function mapOrder(order: Record<string, unknown>) {
  const items = arr(order.order_item);
  const lines = items.map((item) => {
    const faceValueCents = toCents(item.amount);
    const deliveryFeeCents = toCents(item.delivery_fees);
    const totalCents = toCents(item.total_amount);
    return {
      lineId: str(item.id),
      ecardId: str(item.gift_card_id),
      ecardName: str(item.gift_card_name ?? item.name),
      ecardImageUrl: resolveImageUrl(item.image),
      quantity: 1,
      discountPercent: num(item.discount_percentage) ?? 0,
      faceValue: (num(item.amount) ?? 0),
      purchasePrice: Math.max(0, faceValueCents - toCents(item.discount)) / 100,
      deliveryFee: deliveryFeeCents / 100,
      total: totalCents / 100,
      status: mapOrderStatus(item.status),
      orderReference: str(order.order_reference),
      orderNumber: nullableStr(order.order_number),
      cardUrl: nullableStr(item.card_url ?? item.cardurl),
    };
  });

  return {
    orderReference: str(order.order_reference),
    orderNumber: nullableStr(order.order_number) ?? str(order.id),
    status: mapOrderStatus(order.status),
    cardUrl: null as string | null,
    receiptUrl: nullableStr(order.receipt_url),
    currency: str(order.currency_code) || 'AUD',
    totals: {
      faceValue: num(order.subtotal) ?? 0,
      purchasePrice: Math.max(
        0,
        toCents(order.subtotal) - toCents(order.discount_amount),
      ) / 100,
      deliveryFee: num(order.delivery_fee) ?? 0,
      total: num(order.grand_total) ?? 0,
    },
    lines,
    createdAt: nullableStr(order.created_at),
    completedAt: null as string | null,
  };
}

export function walletCardKey(
  entry: Record<string, unknown>,
  gifted: boolean,
): string {
  return createHash('sha256')
    .update(
      [
        gifted ? 'gifted' : 'owned',
        str(entry.order_number ?? entry.order_id),
        str(entry.order_reference),
        str(entry.gift_card_id),
        str(entry.name ?? entry.gift_card_name),
        str(entry.created_at ?? entry.issued_at),
        str(entry.card_number ?? entry.voucher_code),
      ].join('|'),
    )
    .digest('hex');
}

export function mapWalletCard(entry: Record<string, unknown>) {
  const gifted = str(entry.purchase_type).toLowerCase() === 'gift';
  return {
    cardKey: walletCardKey(entry, gifted),
    gifted,
    cardName: str(entry.gift_card_name ?? entry.name),
    value: num(entry.amount),
    issuedAt: nullableStr(entry.created_at ?? entry.issued_at),
    expiresIn: nullableStr(entry.expiry ?? entry.expires_at),
    orderReference: nullableStr(entry.order_reference),
    orderNumber: nullableStr(entry.order_number ?? entry.order_id),
    orderStatus: mapOrderStatus(entry.status),
    cardUrl: nullableStr(entry.card_url ?? entry.cardurl ?? entry.redeem_url),
    cardNumber: nullableStr(entry.card_number ?? entry.voucher_code),
    pin: nullableStr(entry.card_pin ?? entry.pin),
    barcode: nullableStr(entry.barcode),
    balance: num(entry.balance),
    ...(gifted
      ? {
          recipientName: nullableStr(entry.recipient_name),
          recipientEmail: nullableStr(entry.recipient_email),
          cardOpenedAt: nullableStr(entry.card_opened_at),
          linkOpenedAt: nullableStr(entry.link_opened_at),
        }
      : {}),
  };
}
