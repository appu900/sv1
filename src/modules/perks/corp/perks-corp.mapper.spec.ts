import {
  buildCategoryParentIndex,
  mapCatalogueCard,
  mapCategoryTree,
  resolveCategories,
  mapGiftTemplates,
  mapOrder,
  mapOrderStatus,
  mapWalletCard,
  resolveAvailableValues,
  resolveCategory,
  resolveDeliveryFee,
  resolveDiscountPercent,
  resolveImageUrl,
  resolvePricing,
  legacyWalletCardKey,
  walletCardKey,
  isOrderVisible,
} from './perks-corp.mapper';

describe('perks corp mapper', () => {
  describe('resolveDiscountPercent', () => {
    it('prefers the per-site override over the base card rate', () => {
      expect(
        resolveDiscountPercent({
          discount: '3.00',
          site_gift_cards: [{ discount: '2.50' }],
        }),
      ).toBe(2.5);
    });

    it('falls back to the base card when no site override exists', () => {
      expect(
        resolveDiscountPercent({ discount: '4.50', site_gift_cards: [] }),
      ).toBe(4.5);
    });

    it('returns 0 rather than NaN when no discount is present', () => {
      expect(resolveDiscountPercent({})).toBe(0);
    });

    it('ignores per_* tiers entirely — WeMAD asked us to stop reading them', () => {
      expect(
        resolveDiscountPercent({
          discount: '2.00',
          per_gold: '9.00',
          per_platinum: '11.00',
        }),
      ).toBe(2);
    });

    // Which field WeMAD treat as authoritative has changed under us: on
    // 2026-08-25 the cart charged `display_discount`, on 2026-08-29 it charged
    // `discount`. Measured against a real cart both times. `discount` first,
    // falling back when it is zero, matches everything measured on the 29th and
    // still covers cards that only carry a rate in `display_discount`.
    it('prefers discount, which is what the cart charges today', () => {
      expect(
        resolveDiscountPercent({ discount: '2.50', display_discount: '1.50' }),
      ).toBe(2.5);
      expect(
        resolveDiscountPercent({ discount: '9.50', display_discount: '9.50' }),
      ).toBe(9.5);
    });

    it('falls back to display_discount when discount is zero', () => {
      // Cards priced only in display_discount — Hoyts read 0 / 6.65 and was
      // charged 6.65.
      expect(
        resolveDiscountPercent({ discount: '0.00', display_discount: '6.65' }),
      ).toBe(6.65);
      expect(resolveDiscountPercent({ discount: '2.00' })).toBe(2);
      expect(
        resolveDiscountPercent({ discount: '0.00', display_discount: '0.00' }),
      ).toBe(0);
      expect(resolveDiscountPercent({})).toBe(0);
    });
  });

  describe('resolveDeliveryFee', () => {
    it('prefers the per-site override', () => {
      expect(
        resolveDeliveryFee({
          delivery_fee: '5.00',
          site_gift_cards: [{ delivery_fee: '1.00' }],
        }),
      ).toBe(1);
    });

    it('falls back to the base fee', () => {
      expect(resolveDeliveryFee({ delivery_fee: '2.00' })).toBe(2);
      expect(resolveDeliveryFee({})).toBe(0);
    });
  });

  describe('resolveImageUrl', () => {
    it('expands storage-relative paths', () => {
      expect(resolveImageUrl('giftcards/1.jpg')).toBe(
        'https://admin.wemad.com.au/storage/giftcards/1.jpg',
      );
    });

    it('passes unrelated absolute URLs through untouched', () => {
      expect(resolveImageUrl('https://cdn.example.com/a.png')).toBe(
        'https://cdn.example.com/a.png',
      );
    });

    it('rewrites sandbox storage URLs onto the admin host', () => {
      expect(
        resolveImageUrl(
          'https://sandbox.wemad.com.au/storage/giftcards/883.jpg',
        ),
      ).toBe('https://admin.wemad.com.au/storage/giftcards/883.jpg');
    });

    it('rejects traversal attempts', () => {
      expect(resolveImageUrl('../../etc/passwd')).toBeNull();
    });

    it('treats empty and null-ish values as absent', () => {
      expect(resolveImageUrl('')).toBeNull();
      expect(resolveImageUrl(null)).toBeNull();
      expect(resolveImageUrl('null')).toBeNull();
    });
  });

  describe('resolveAvailableValues', () => {
    it('reads denominations from the nested provider product, sorted', () => {
      const card = {
        provider_product: {
          available_denominations: [
            { amount: '100.00' },
            { amount: '50.00' },
            { amount: '300.00' },
          ],
        },
      };
      expect(resolveAvailableValues(card)).toEqual([50, 100, 300]);
    });

    it('returns an empty list when the listing payload omits the product', () => {
      expect(resolveAvailableValues({ id: 1 })).toEqual([]);
    });
  });

  describe('resolvePricing', () => {
    it('uses fixed denominations when the card has them', () => {
      const pricing = resolvePricing({
        provider_product: {
          price_type: 'fixed',
          available_denominations: [{ amount: '50.00' }, { amount: '100.00' }],
        },
      });
      expect(pricing).toMatchObject({
        availableValues: [50, 100],
        variablePrice: false,
        minAmount: 50,
        maxAmount: 100,
      });
    });

    it('builds a ladder inside min/max for variable cards', () => {
      const pricing = resolvePricing({
        provider_product: {
          price_type: 'variable',
          min_amount: '10.00',
          max_amount: '100.00',
          available_denominations: [],
        },
      });
      expect(pricing.variablePrice).toBe(true);
      expect(pricing.availableValues[0]).toBe(10);
      expect(pricing.availableValues.at(-1)).toBe(100);
      expect(Math.max(...pricing.availableValues)).toBeLessThanOrEqual(100);
      expect(Math.min(...pricing.availableValues)).toBeGreaterThanOrEqual(10);
    });

    it('reports unknown, not unsellable, when a listing omits the product', () => {
      const pricing = resolvePricing({ id: 5, name: 'BigW' });
      expect(pricing.purchasable).toBeNull();
      expect(pricing.availableValues).toEqual([]);
    });

    it('is definite when a card detail omits the product', () => {
      const pricing = resolvePricing({ id: 309, name: 'Doordash' }, { detailed: true });
      expect(pricing.purchasable).toBe(false);
      expect(pricing.availableValues).toEqual([]);
    });

    it('marks fixed cards with no denominations unpurchasable', () => {
      const pricing = resolvePricing({
        provider_product: { price_type: 'fixed', available_denominations: [] },
      });
      expect(pricing.purchasable).toBe(false);
      expect(pricing.availableValues).toEqual([]);
    });

    it('always includes the exact bounds so extremes stay reachable', () => {
      const pricing = resolvePricing({
        provider_product: { min_amount: '15.00', max_amount: '85.00' },
      });
      expect(pricing.availableValues).toContain(15);
      expect(pricing.availableValues).toContain(85);
      expect(pricing.purchasable).toBe(true);
    });
  });

  describe('resolveCategory', () => {
    it('prefers the leaf category over the broad parent bucket', () => {
      const card = {
        categories: [
          { id: 40, parent_id: null, name: 'Shop', slug: 'shop' },
          { id: 5, parent_id: 40, name: 'Department Stores', slug: 'department-store' },
        ],
      };
      expect(resolveCategory(card)).toBe('department-store');
    });

    it('returns null when the card carries no categories', () => {
      expect(resolveCategory({ categories: [] })).toBeNull();
    });
  });

  describe('resolveCategories (browse grouping)', () => {
    const tree = mapCategoryTree([
      {
        id: 43, slug: 'travel-and-exp-', name: 'Travel & Exp',
        children: [{ id: 16, slug: 'accommodation', name: 'Accommodation' }],
      },
      {
        id: 40, slug: 'shop', name: 'Shop',
        children: [{ id: 5, slug: 'department-store', name: 'Department Stores' }],
      },
    ]);
    const index = buildCategoryParentIndex(tree);

    it('uses the parent the card carries inline', () => {
      const result = resolveCategories({
        categories: [
          { id: 40, parent_id: null, slug: 'shop', name: 'Shop' },
          { id: 5, parent_id: 40, slug: 'department-store', name: 'Department Stores' },
        ],
      });
      expect(result).toMatchObject({
        category: 'department-store',
        categoryGroup: 'shop',
        categoryGroupName: 'Shop',
      });
    });

    it('resolves a leaf-only card to its real group via the tree', () => {
      const card = {
        categories: [
          { id: 16, parent_id: 43, slug: 'accommodation', name: 'Accommodation' },
        ],
      };
      expect(resolveCategories(card).categoryGroup).toBe('accommodation');
      expect(resolveCategories(card, index)).toMatchObject({
        category: 'accommodation',
        categoryGroup: 'travel-and-exp-',
        categoryGroupName: 'Travel & Exp',
      });
    });

    it('treats a genuinely top-level category as its own group', () => {
      expect(
        resolveCategories(
          { categories: [{ id: 40, parent_id: null, slug: 'shop', name: 'Shop' }] },
          index,
        ),
      ).toMatchObject({ category: 'shop', categoryGroup: 'shop' });
    });

    it('returns nulls for an uncategorised card', () => {
      expect(resolveCategories({ categories: [] }, index)).toMatchObject({
        category: null,
        categoryGroup: null,
      });
    });
  });

  describe('mapCatalogueCard', () => {
    const card = {
      id: 1,
      name: 'WISH gift card from Woolworths',
      image: 'giftcards/1.jpg',
      balance_link: 'https://example.com/balance',
      description: '<p>desc</p>',
      term: '<p>terms</p>',
      delivery_fee: '1.00',
      discount: '2.00',
      is_popular: 0,
      categories: [{ id: 14, parent_id: 10, slug: 'groceries', name: 'Groceries' }],
      provider_product: {
        price_type: 'fixed',
        available_denominations: [{ amount: '50.00' }],
      },
    };

    it('maps a corp card onto the app catalogue shape', () => {
      expect(mapCatalogueCard(card)).toMatchObject({
        id: '1',
        name: 'WISH gift card from Woolworths',
        category: 'groceries',
        discountPercent: 2,
        imageUrl: 'https://admin.wemad.com.au/storage/giftcards/1.jpg',
        priceType: 'fixed',
        availableValues: [50],
        deliveryFee: 1,
      });
    });

    it('marks cards featured on a strong discount even when is_popular is 0', () => {
      expect(mapCatalogueCard({ ...card, discount: '7.00' }).featured).toBe(
        true,
      );
      expect(mapCatalogueCard(card).featured).toBe(false);
    });

    it('marks an unpriced card unbuyable when mapping a detail response', () => {
      const unpriced = { id: 309, name: 'Doordash', discount: '9.00' };
      expect(mapCatalogueCard(unpriced, undefined, { detailed: true })).toMatchObject({
        purchasable: false,
        availableValues: [],
      });
      expect(mapCatalogueCard(unpriced).purchasable).toBeNull();
    });

    it('honours an explicit is_popular flag', () => {
      expect(
        mapCatalogueCard({ ...card, is_popular: 1 }).featured,
      ).toBe(true);
    });
  });

  describe('mapGiftTemplates', () => {
    it('flattens templates with their designs', () => {
      const detail = {
        gift_templates: [
          {
            id: 2,
            template_name: 'Happy Birthday',
            template_subject: 'Happy Birthday',
            designs: [
              { id: 1, name: 'Balloon', thumbnail: 'a/t.png', image: 'a/i.png' },
            ],
          },
        ],
      };
      expect(mapGiftTemplates(detail)).toEqual([
        {
          id: '2',
          name: 'Happy Birthday',
          subject: 'Happy Birthday',
          designs: [
            {
              id: '1',
              name: 'Balloon',
              thumbnailUrl: 'https://admin.wemad.com.au/storage/a/t.png',
              imageUrl: 'https://admin.wemad.com.au/storage/a/i.png',
            },
          ],
        },
      ]);
    });

    it('tolerates a card with no templates', () => {
      expect(mapGiftTemplates({})).toEqual([]);
    });
  });

  describe('mapOrderStatus', () => {
    it.each([
      ['completed', 'completed'],
      ['sent', 'completed'],
      ['processing', 'processing'],
      ['pending', 'processing'],
      ['refunded', 'refunded'],
      ['cancelled', 'refunded'],
      ['failed', 'failed'],
      ['delivered', 'completed'],
      ['declined', 'failed'],
      ['something-else', 'processing'],
      ['', 'processing'],
    ])('maps %s → %s', (input, expected) => {
      expect(mapOrderStatus(input)).toBe(expected);
    });
  });

  describe('mapOrder', () => {
    it('maps totals and lines from a corp order', () => {
      const order = {
        id: 1,
        order_reference: 'REF-1',
        order_number: '0001',
        status: 'processing',
        subtotal: '350.00',
        discount_amount: '30.00',
        delivery_fee: '3.00',
        grand_total: '323.00',
        currency_code: 'AUD',
        created_at: '2026-06-20T11:05:25.000000Z',
        order_item: [
          {
            id: 1,
            gift_card_id: 1,
            amount: '100.00',
            discount_percentage: '5.00',
            discount: '5.00',
            delivery_fees: '1.00',
            total_amount: '96.00',
            status: 'sent',
          },
        ],
      };

      const mapped = mapOrder(order);
      expect(mapped.orderNumber).toBe('0001');
      expect(mapped.status).toBe('processing');
      expect(mapped.totals).toEqual({
        faceValue: 350,
        purchasePrice: 320,
        deliveryFee: 3,
        total: 323,
        savings: 30,
        cashback: 0,
      });
      expect(mapped.lines).toHaveLength(1);
      expect(mapped.lines[0]).toMatchObject({
        ecardId: '1',
        faceValue: 100,
        purchasePrice: 95,
        deliveryFee: 1,
        total: 96,
        status: 'completed',
      });
    });

    it('falls back to the internal id when order_number is absent', () => {
      expect(mapOrder({ id: 42, order_item: [] }).orderNumber).toBe('42');
    });
  });

  describe('order line labelling', () => {
    it('uses an embedded gift_card when the line carries one', () => {
      const order = {
        order_number: '0001',
        order_item: [
          {
            id: 9,
            gift_card_id: 3,
            amount: '50.00',
            gift_card: { id: 3, name: 'Coles Gift Card', image: 'giftcards/3.jpg' },
          },
        ],
      };
      expect(mapOrder(order).lines[0]).toMatchObject({
        ecardId: '3',
        ecardName: 'Coles Gift Card',
        ecardImageUrl: 'https://admin.wemad.com.au/storage/giftcards/3.jpg',
      });
    });

    it('falls back to the catalogue when the line is just an id', () => {
      const order = {
        order_number: '0001',
        order_item: [{ id: 9, gift_card_id: 3, amount: '50.00' }],
      };
      const cards = new Map([
        ['3', { name: 'Coles Gift Card', imageUrl: 'https://cdn/coles.png' }],
      ]);
      expect(mapOrder(order, cards).lines[0]).toMatchObject({
        ecardName: 'Coles Gift Card',
        ecardImageUrl: 'https://cdn/coles.png',
      });
    });
  });

  describe('order receipt / invoice link', () => {
    const base = { order_reference: 'REF-1', order_number: '0001', order_item: [] };

    it('picks up an invoice link under any of the names they might ship', () => {
      // WeMAD are adding this to the order detail; accept the likely spellings
      // so it works on their release day without a change here.
      expect(mapOrder({ ...base, receipt_url: 'https://r/1' }).receiptUrl).toBe(
        'https://r/1',
      );
      expect(mapOrder({ ...base, invoice_url: 'https://i/1' }).receiptUrl).toBe(
        'https://i/1',
      );
      expect(mapOrder({ ...base, invoice_link: 'https://l/1' }).receiptUrl).toBe(
        'https://l/1',
      );
      expect(mapOrder({ ...base, invoice: 'https://v/1' }).receiptUrl).toBe(
        'https://v/1',
      );
    });

    it('ignores a non-string invoice field rather than rendering [object Object]', () => {
      expect(mapOrder({ ...base, invoice: { id: 7 } }).receiptUrl).toBeNull();
      expect(mapOrder(base).receiptUrl).toBeNull();
    });
  });

  describe('wallet mapping', () => {
    const entry = {
      order_number: '0001',
      order_reference: 'REF-1',
      gift_card_id: 1,
      gift_card_name: 'Coles',
      amount: '50.00',
      status: 'sent',
      purchase_type: 'self',
      card_number: '627123',
      created_at: '2026-06-23T05:05:30.000000Z',
    };

    /**
     * Their wallet rows are shaped like order lines: a gift_card_id and an
     * amount, with the brand name and artwork living on the gift card. These
     * cover the three shapes we can receive, because a wallet showing
     * "eGift card" and a grey placeholder for every purchase is the failure
     * this mapping exists to prevent.
     */
    it('takes the name and artwork from an embedded gift_card', () => {
      expect(
        mapWalletCard({
          ...entry,
          gift_card_name: undefined,
          gift_card: {
            id: 1,
            name: 'Coles Gift Card',
            image: 'giftcards/3.jpg',
            balance_link: 'https://coles/balance',
          },
        }),
      ).toMatchObject({
        ecardId: '1',
        cardName: 'Coles Gift Card',
        imageUrl: 'https://admin.wemad.com.au/storage/giftcards/3.jpg',
        balanceLink: 'https://coles/balance',
      });
    });

    it('falls back to the catalogue when the row carries only an id', () => {
      const catalogue = new Map([
        [
          '1',
          {
            name: 'Coles Gift Card',
            imageUrl: 'https://cdn/coles.png',
            balanceLink: 'https://coles/balance',
          },
        ],
      ]);

      expect(
        mapWalletCard(
          { ...entry, gift_card_name: undefined, name: undefined },
          catalogue,
        ),
      ).toMatchObject({
        cardName: 'Coles Gift Card',
        imageUrl: 'https://cdn/coles.png',
      });
    });

    // Shape captured from a live account on 2026-09-01. `/my-gift-cards`
    // returns orders; the purchased card is an `order_item`, and mapping the
    // ORDER instead is what produced "Gift card" for $0 on every wallet row.
    it('maps a real order item, name, value and voucher included', () => {
      const item = {
        id: 400030,
        order_id: 400017,
        gift_card_id: 774,
        amount: '25.00',
        total_amount: '24.38',
        purchase_type: 'self',
        status: 'completed',
        order_number: 'WMDAU3-202609011005059EA11BC2',
        gift_card: {
          id: 774,
          name: 'IGA Supermarkets (Grocery Only) Gift Card',
          image: 'giftcards/01M0J31RNXGRX2PTH73GVX3BCA.jpg',
          balance_link: 'https://igagiftcards.viisolutions.com.au/',
        },
        // Shape as of 2026-09-02, when WeMAD added `url`.
        gift_card_stock: {
          status: 'sold',
          access_type: 'link',
          value: '25.00',
          token: '3vW1LmKSoQeMb9bT0OHoe3yEPViec3BvDG4LEbYYgrAdbMZkSak7yAEGitTRMJJ4',
          url: 'https://perks.saveful.app/giftcard/access/3vW1LmKSoQeMb9bT0OHoe3yEPViec3BvDG4LEbYYgrAdbMZkSak7yAEGitTRMJJ4',
        },
      };

      expect(mapWalletCard(item)).toMatchObject({
        cardName: 'IGA Supermarkets (Grocery Only) Gift Card',
        value: 25,
        gifted: false,
        orderNumber: 'WMDAU3-202609011005059EA11BC2',
        balanceLink: 'https://igagiftcards.viisolutions.com.au/',
        // What "View card securely" opens.
        cardUrl:
          'https://perks.saveful.app/giftcard/access/3vW1LmKSoQeMb9bT0OHoe3yEPViec3BvDG4LEbYYgrAdbMZkSak7yAEGitTRMJJ4',
      });
      expect(mapWalletCard(item).imageUrl).toContain(
        '01M0J31RNXGRX2PTH73GVX3BCA.jpg',
      );
    });

    it('keeps the recipient on a gifted item that is not issued yet', () => {
      // Kim's cards: purchased, still pending, so no voucher exists.
      const gift = {
        id: 400031,
        gift_card_id: 55,
        amount: '50.00',
        purchase_type: 'gift',
        status: 'pending',
        recipient_name: 'Kim McDonnell',
        recipient_email: 'kimm@thankful.org',
        recipient_phone: '400101868',
        gift_card: { id: 55, name: 'Lorna Jane Gift Card' },
        gift_card_stock: null,
      };

      const mapped = mapWalletCard(gift);
      expect(mapped).toMatchObject({
        cardName: 'Lorna Jane Gift Card',
        value: 50,
        gifted: true,
        recipientName: 'Kim McDonnell',
      });
      // Not issued yet, so there is nothing to open — the screen shows its
      // "still being issued" state rather than a dead button.
      expect(mapped.cardUrl).toBeNull();
      expect(mapped.cardNumber).toBeNull();
      expect(mapped.pin).toBeNull();
    });

    // `Number(null)` is 0, which is finite, so an empty first field used to
    // stop the fallback chain dead and report the card as worthless.
    it('falls past an empty amount to the value that is there', () => {
      expect(mapWalletCard({ amount: null, face_value: '25.00' }).value).toBe(25);
      expect(mapWalletCard({ amount: '', gift_card_stock: { value: '40.00' } }).value)
        .toBe(40);
      // Nothing anywhere still means nothing — not zero.
      expect(mapWalletCard({ status: 'sent' }).value).toBeNull();
    });

    it('never renders a nameless card, even with nothing to join on', () => {
      const mapped = mapWalletCard({ amount: '50.00', status: 'sent' });
      expect(mapped.cardName).toBe('Gift card');
      expect(mapped.imageUrl).toBeNull();
      expect(mapped.value).toBe(50);
    });

    it('reads the value and balance however they are named', () => {
      expect(mapWalletCard({ face_value: '25.00', balance: '10.00' })).toMatchObject(
        { value: 25, balance: 10 },
      );
    });

    it('does not collide when rows carry no identifiers at all', () => {
      // Two such rows would otherwise share a key, and archiving one would
      // archive the other.
      expect(
        walletCardKey({ gift_card_name: 'Coles', amount: '50' }, false),
      ).not.toBe(walletCardKey({ gift_card_name: 'Kmart', amount: '20' }, false));
    });

    it('keeps the same key once the card is issued', () => {
      // The old key hashed the voucher code, which only appears on issue — so a
      // card archived while processing lost its archive the moment it issued.
      const processing = { ...entry, card_number: undefined, status: 'processing' };
      const issued = { ...entry, card_number: '627123456', status: 'sent' };

      expect(walletCardKey(processing, false)).toBe(walletCardKey(issued, false));
      expect(legacyWalletCardKey(processing, false)).not.toBe(
        legacyWalletCardKey(issued, false),
      );
    });

    it('is unaffected by the name resolving differently', () => {
      expect(walletCardKey({ ...entry, gift_card_name: undefined }, false)).toBe(
        walletCardKey({ ...entry, gift_card_name: 'Coles Gift Card' }, false),
      );
    });

    it('still separates two different cards in one order', () => {
      expect(walletCardKey({ ...entry, id: 1, gift_card_id: 1 }, false)).not.toBe(
        walletCardKey({ ...entry, id: 2, gift_card_id: 3 }, false),
      );
    });

    it('produces a stable key for the same card across responses', () => {
      expect(walletCardKey(entry, false)).toBe(walletCardKey({ ...entry }, false));
    });

    it('separates owned from gifted cards', () => {
      expect(walletCardKey(entry, false)).not.toBe(walletCardKey(entry, true));
    });

    it('maps an owned card', () => {
      expect(mapWalletCard(entry)).toMatchObject({
        gifted: false,
        cardName: 'Coles',
        value: 50,
        orderNumber: '0001',
        orderStatus: 'completed',
        cardNumber: '627123',
      });
    });

    it('includes recipient details only for gifted cards', () => {
      const gifted = mapWalletCard({
        ...entry,
        purchase_type: 'gift',
        recipient_name: 'John',
        recipient_email: 'john@example.com',
      });
      expect(gifted.gifted).toBe(true);
      expect(gifted).toMatchObject({
        recipientName: 'John',
        recipientEmail: 'john@example.com',
      });
      expect(mapWalletCard(entry)).not.toHaveProperty('recipientName');
    });
  });
});

/**
 * WeMAD reported (2026-09-03) that orders which never completed payment were
 * appearing in the app. They were: we rendered everything `/orders` returned.
 *
 * The risk in fixing it is over-hiding. Several of Mike's cards are paid but
 * still unfulfilled upstream, and hiding those would delete a customer's only
 * record of being charged — so these tests pin both directions.
 */
describe('isOrderVisible', () => {
  it('hides an order whose payment never completed', () => {
    for (const status of [
      'unpaid',
      'incomplete',
      'pending_payment',
      'awaiting_payment',
      'failed',
      'abandoned',
      'expired',
    ]) {
      expect(isOrderVisible({ status })).toBe(false);
      expect(isOrderVisible({ payment_status: status })).toBe(false);
    }
  });

  it('keeps a paid order however its fulfilment is going', () => {
    // Live shape, 2026-09-01: paid, still pending upstream. This is Mike's
    // stuck gift card — the exact row a blanket "hide everything not
    // completed" filter would wrongly erase.
    expect(
      isOrderVisible({ status: 'pending', payment_status: 'paid' }),
    ).toBe(true);
    expect(isOrderVisible({ status: 'processing' })).toBe(true);
    expect(isOrderVisible({ status: 'completed' })).toBe(true);
    expect(isOrderVisible({ status: 'sent' })).toBe(true);
  });

  it('keeps an order that took money even when its state says otherwise', () => {
    // Money changed hands. Whatever the state string says, the customer is
    // entitled to see it — a refund and a failed capture look alike from here.
    expect(isOrderVisible({ status: 'failed', paid_amount: '24.38' })).toBe(true);
    expect(isOrderVisible({ status: 'cancelled', total_paid: '10.00' })).toBe(true);
  });

  it('keeps an order whose status we do not recognise', () => {
    // Their status enum has never been published. Guessing wrong in this
    // direction shows one row too many; guessing wrong the other way hides a
    // card someone paid for.
    expect(isOrderVisible({ status: 'awaiting_stock' })).toBe(true);
    expect(isOrderVisible({ status: '' })).toBe(true);
    expect(isOrderVisible({})).toBe(true);
  });

  it('keeps refunded and cancelled orders that carry no payment field', () => {
    // Not in WeMAD's list of what to hide, and a refund is a real financial
    // event the customer should still be able to find.
    expect(isOrderVisible({ status: 'refunded' })).toBe(true);
  });
});
