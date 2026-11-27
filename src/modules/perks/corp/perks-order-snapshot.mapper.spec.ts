import { perksCategoryKeyFor } from '../perks.service';
import { toOrderSnapshot } from './perks-order-snapshot.mapper';

describe('toOrderSnapshot', () => {
  const none = new Map();

  it('falls back to the order number when there is no reference', () => {
    const snapshot = toOrderSnapshot(
      { id: 3, order_number: '0003', status: 'processing', order_item: [] },
      none,
      perksCategoryKeyFor,
    );
    expect(snapshot?.orderKey).toBe('0003');
  });

  it('returns null for a row with no identity at all', () => {
    expect(toOrderSnapshot({ order_item: [] }, none, perksCategoryKeyFor)).toBeNull();
  });

  it('sums line amounts when WeMAD leaves the order totals empty', () => {
    const snapshot = toOrderSnapshot(
      {
        order_reference: 'R',
        order_item: [
          { id: 1, gift_card_id: '5', amount: '20.00', discount: '1.00', total_amount: '19.00' },
          { id: 2, gift_card_id: '6', amount: '30.00', discount: '0', total_amount: '30.00' },
        ],
      },
      none,
      perksCategoryKeyFor,
    )!;
    expect(snapshot.faceValueCents).toBe(5000);
    expect(snapshot.purchasePriceCents).toBe(4900);
    expect(snapshot.totalCents).toBe(4900);
    expect(snapshot.savingsCents).toBe(100);
    expect(snapshot.lines.every((l) => l.perksCategory === null)).toBe(true);
  });

  it('keeps unparseable dates as null rather than Invalid Date', () => {
    const snapshot = toOrderSnapshot(
      { order_reference: 'R', created_at: 'soon', order_item: [] },
      none,
      perksCategoryKeyFor,
    )!;
    expect(snapshot.orderedAt).toBeNull();
  });
});

describe('perksCategoryKeyFor', () => {
  it('matches slugs, aliases and display names', () => {
    expect(perksCategoryKeyFor('groceries')).toBe('groceries');
    expect(perksCategoryKeyFor('petrol')).toBe('fuel');
    expect(perksCategoryKeyFor(null, 'Pharmacy, Health & Beauty')).toBe('pharmacy');
    expect(perksCategoryKeyFor('Travel & Accommodation')).toBe('travel');
  });

  it('tries candidates in order and returns null when none match', () => {
    expect(perksCategoryKeyFor('supermarkets', 'groceries')).toBe('groceries');
    expect(perksCategoryKeyFor('something-else', '')).toBeNull();
  });
});
