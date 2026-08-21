import { createHash } from 'crypto';

const CARD_IMAGE_BASE = 'https://sandbox.wemad.com.au/storage';

export interface CatalogueCard {
  id: string;
  name: string;
  category: string | null;
  categoryName: string | null;
  categoryGroup: string | null;
  categoryGroupName: string | null;
  discountPercent: number;
  imageFilename: string | null;
  imageUrl: string | null;
  priceType: string;
  availableValues: number[];
  variablePrice: boolean;
  minAmount: number | null;
  maxAmount: number | null;
  balanceLink: string | null;
  description: string | null;
  terms: string | null;
  deliveryFee: number;
  featured: boolean;
  purchasable: boolean | null;
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


function siteAware(
  card: Record<string, unknown>,
  field: string,
): number | null {
  const siteOverride = arr(card.site_gift_cards)[0];
  const fromSite = siteOverride ? num(siteOverride[field]) : null;
  return fromSite !== null ? fromSite : num(card[field]);
}

export function resolveDiscountPercent(card: Record<string, unknown>): number {
  const resolved = siteAware(card, 'discount');
  if (resolved !== null && resolved > 0) return resolved;
  return siteAware(card, 'display_discount') ?? resolved ?? 0;
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

const LADDER = [10, 20, 25, 50, 75, 100, 150, 200, 250, 300, 500, 1000];

export function resolvePricing(
  card: Record<string, unknown>,
  options: { detailed?: boolean } = {},
): {
  priceType: string;
  availableValues: number[];
  variablePrice: boolean;
  minAmount: number | null;
  maxAmount: number | null;
  purchasable: boolean | null;
} {
  const providerProduct = card.provider_product as
    | Record<string, unknown>
    | undefined;

  if (!providerProduct) {
    return {
      priceType: '',
      availableValues: [],
      variablePrice: false,
      minAmount: null,
      maxAmount: null,
      purchasable: options.detailed ? false : null,
    };
  }

  const priceType = str(providerProduct.price_type).toLowerCase();
  const fixed = resolveAvailableValues(card);

  if (priceType === 'fixed' || fixed.length > 0) {
    return {
      priceType: 'fixed',
      availableValues: fixed,
      variablePrice: false,
      minAmount: fixed[0] ?? null,
      maxAmount: fixed[fixed.length - 1] ?? null,
      purchasable: fixed.length > 0,
    };
  }

  const min = num(providerProduct.min_amount);
  const max = num(providerProduct.max_amount);
  if (min === null || max === null || max <= 0) {
    return {
      priceType: priceType || 'variable',
      availableValues: [],
      variablePrice: true,
      minAmount: min,
      maxAmount: max,
      purchasable: false,
    };
  }

  const presets = Array.from(
    new Set([min, ...LADDER.filter((v) => v > min && v < max), max]),
  ).sort((left, right) => left - right);

  return {
    priceType: 'variable',
    availableValues: presets,
    variablePrice: true,
    minAmount: min,
    maxAmount: max,
    purchasable: true,
  };
}

export type CategoryParentIndex = Map<string, { slug: string; name: string }>;

export function buildCategoryParentIndex(
  tree: ReturnType<typeof mapCategoryTree>,
): CategoryParentIndex {
  const index: CategoryParentIndex = new Map();
  for (const group of tree) {
    const parent = { slug: group.slug, name: group.name };
    for (const child of group.children) {
      index.set(child.slug, parent);
      index.set(child.id, parent);
    }
  }
  return index;
}

export function resolveCategories(
  card: Record<string, unknown>,
  parentIndex?: CategoryParentIndex,
): {
  category: string | null;
  categoryName: string | null;
  categoryGroup: string | null;
  categoryGroupName: string | null;
} {
  const categories = arr(card.categories);
  if (!categories.length) {
    return {
      category: null,
      categoryName: null,
      categoryGroup: null,
      categoryGroupName: null,
    };
  }

  const inlineParent = categories.find((entry) => entry.parent_id === null);
  const leaf =
    categories.find((entry) => entry.parent_id !== null) ??
    inlineParent ??
    categories[0];
  const leafSlug = nullableStr(leaf.slug);
  const fromIndex =
    !inlineParent && parentIndex
      ? parentIndex.get(leafSlug ?? '') ?? parentIndex.get(str(leaf.id))
      : undefined;

  const group = inlineParent
    ? {
        slug: nullableStr(inlineParent.slug) ?? nullableStr(inlineParent.name),
        name: nullableStr(inlineParent.name),
      }
    : fromIndex
      ? { slug: fromIndex.slug, name: fromIndex.name }
      : { slug: leafSlug ?? nullableStr(leaf.name), name: nullableStr(leaf.name) };

  return {
    category: leafSlug ?? nullableStr(leaf.name),
    categoryName: nullableStr(leaf.name),
    categoryGroup: group.slug,
    categoryGroupName: group.name,
  };
}
export function resolveCategory(card: Record<string, unknown>): string | null {
  return resolveCategories(card).category;
}

export function mapCategoryTree(categories: Record<string, unknown>[]) {
  return categories.map((parent) => ({
    id: str(parent.id),
    slug: nullableStr(parent.slug) ?? str(parent.id),
    name: str(parent.name),
    imageUrl: resolveImageUrl(parent.image),
    children: arr(parent.children).map((child) => ({
      id: str(child.id),
      slug: nullableStr(child.slug) ?? str(child.id),
      name: str(child.name),
      imageUrl: resolveImageUrl(child.image),
    })),
  }));
}

export function mapCatalogueCard(
  card: Record<string, unknown>,
  parentIndex?: CategoryParentIndex,
  options: { detailed?: boolean } = {},
): CatalogueCard {
  const discountPercent = resolveDiscountPercent(card);
  const isPopular = num(card.is_popular) ?? 0;
  const pricing = resolvePricing(card, options);
  return {
    id: str(card.id),
    name: str(card.name).trim(),
    ...resolveCategories(card, parentIndex),
    discountPercent,
    imageFilename: nullableStr(card.image),
    imageUrl: resolveImageUrl(card.image),
    priceType: pricing.priceType,
    availableValues: pricing.availableValues,
    variablePrice: pricing.variablePrice,
    minAmount: pricing.minAmount,
    maxAmount: pricing.maxAmount,
    purchasable: pricing.purchasable,
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
  const raw = str(value).toLowerCase().trim();
  if (!raw) return 'processing';
  switch (raw) {
    case 'completed':
    case 'complete':
    case 'sent':
    case 'delivered':
    case 'success':
    case 'paid':
      return 'completed';
    case 'processing':
    case 'pending':
    case 'in_progress':
    case 'awaiting':
      return 'processing';
    case 'refunded':
    case 'cancelled':
    case 'canceled':
    case 'reversed':
      return 'refunded';
    case 'failed':
    case 'declined':
    case 'error':
      return 'failed';
    default:
      return 'processing';
  }
}

const toCents = (value: unknown): number =>
  Math.round((num(value) ?? 0) * 100);

/** First candidate that is genuinely a non-empty string. */
const firstString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed && trimmed.toLowerCase() !== 'null') return trimmed;
  }
  return null;
};

export type OrderCardLookup = Map<
  string,
  { name: string; imageUrl: string | null; balanceLink?: string | null }
>;

export function mapOrder(
  order: Record<string, unknown>,
  cards?: OrderCardLookup,
) {
  const items = arr(order.order_item);
  const lines = items.map((item) => {
    const faceValueCents = toCents(item.amount);
    const deliveryFeeCents = toCents(item.delivery_fees);
    const totalCents = toCents(item.total_amount);
    const ecardId = str(item.gift_card_id);
    const catalogue = cards?.get(ecardId);
    return {
      lineId: str(item.id),
      ecardId,
      ecardName:
        nullableStr(item.gift_card_name ?? item.name) ??
        catalogue?.name ??
        'Gift card',
      ecardImageUrl: resolveImageUrl(item.image) ?? catalogue?.imageUrl ?? null,
      quantity: 1,
      discountPercent: num(item.discount_percentage) ?? 0,
      faceValue: (num(item.amount) ?? 0),
      purchasePrice: Math.max(0, faceValueCents - toCents(item.discount)) / 100,
      discount: num(item.discount) ?? 0,
      deliveryFee: deliveryFeeCents / 100,
      total: totalCents / 100,
      cashback: num(item.cashback) ?? 0,
      status: mapOrderStatus(item.status),
      orderReference: str(order.order_reference),
      orderNumber: nullableStr(order.order_number),
      cardUrl: nullableStr(item.card_url ?? item.cardurl),
      purchaseType: str(item.purchase_type) || 'self',
      recipientName: nullableStr(item.recipient_name),
      recipientEmail: nullableStr(item.recipient_email),
      giftMessage: nullableStr(item.gift_message),
      sendAt: nullableStr(item.send_at),
    };
  });

  return {
    orderReference: str(order.order_reference),
    orderNumber: nullableStr(order.order_number) ?? str(order.id),
    status: mapOrderStatus(order.status),
    cardUrl: null as string | null,
    // WeMAD are adding an invoice link to the order detail (2026-08). Accept the
    // likely field names now so it appears the day they ship it, and only take
    // string values — one of these could arrive as an object.
    receiptUrl: firstString(
      order.receipt_url,
      order.invoice_url,
      order.invoice_link,
      order.invoice,
    ),
    currency: str(order.currency_code) || 'AUD',
    totals: {
      faceValue: num(order.subtotal) ?? 0,
      purchasePrice: Math.max(
        0,
        toCents(order.subtotal) - toCents(order.discount_amount),
      ) / 100,
      deliveryFee: num(order.delivery_fee) ?? 0,
      total: num(order.grand_total) ?? 0,
      savings: (num(order.discount_amount) ?? 0),
      cashback: num(order.cashback_amount) ?? 0,
    },
    lines,
    createdAt: nullableStr(order.created_at),
    completedAt: null as string | null,
    payment: {
      status: nullableStr(order.payment_status),
      method: nullableStr(order.payment_method),
      surcharge: num(order.payment_surcharge) ?? 0,
      paid: num(order.paid_amount) ?? 0,
      due: num(order.due_amount) ?? 0,
      totalPaid: num(order.total_paid) ?? 0,
      walletAmount: num(order.wallet_amount) ?? 0,
      couponAmount: num(order.coupon_amount) ?? 0,
      discountType: nullableStr(order.discount_type),
    },
    source: nullableStr(order.order_source ?? order.platform),
    notes: nullableStr(order.notes),
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

/**
 * WeMAD's wallet entries are shaped like order lines: they carry `gift_card_id`
 * and an amount, but the brand name and artwork live on the gift card itself.
 * Some payloads embed a `gift_card` object (their cart response does), others
 * do not — so read the embedded card when present and fall back to the
 * catalogue by id. Without this the wallet showed every card as "eGift card"
 * with a placeholder image.
 */
export function mapWalletCard(
  entry: Record<string, unknown>,
  cards?: OrderCardLookup,
) {
  const gifted = str(entry.purchase_type).toLowerCase() === 'gift';
  const embedded = (entry.gift_card ?? {}) as Record<string, unknown>;
  const ecardId = str(entry.gift_card_id ?? embedded.id);
  const catalogue = cards?.get(ecardId);

  const cardName =
    nullableStr(embedded.name) ??
    nullableStr(entry.gift_card_name) ??
    nullableStr(entry.name) ??
    catalogue?.name ??
    'Gift card';

  const imageUrl =
    resolveImageUrl(embedded.image) ??
    resolveImageUrl(entry.image) ??
    catalogue?.imageUrl ??
    null;

  return {
    cardKey: walletCardKey(entry, gifted),
    gifted,
    ecardId,
    cardName,
    imageUrl,
    // `amount` is the face value on their order lines; the others are defensive
    // in case the wallet payload names it differently.
    value: num(entry.amount) ?? num(entry.face_value) ?? num(entry.value),
    issuedAt: nullableStr(entry.created_at ?? entry.issued_at),
    expiresIn: nullableStr(entry.expiry ?? entry.expires_at ?? entry.expiry_date),
    orderReference: nullableStr(entry.order_reference),
    orderNumber: nullableStr(entry.order_number ?? entry.order_id),
    orderStatus: mapOrderStatus(entry.status),
    cardUrl: nullableStr(entry.card_url ?? entry.cardurl ?? entry.redeem_url),
    cardNumber: nullableStr(
      entry.card_number ?? entry.voucher_code ?? entry.voucher_id,
    ),
    pin: nullableStr(entry.card_pin ?? entry.pin),
    barcode: nullableStr(entry.barcode ?? embedded.barcode_type),
    balance: num(entry.balance) ?? num(entry.remaining_balance),
    balanceLink: nullableStr(embedded.balance_link) ?? catalogue?.balanceLink ?? null,
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
