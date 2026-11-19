/**
 * One-off in-app surveys with a thank-you gift. Wording comes from the
 * design file "Saveful screens Savi update 2610" (19 Nov version, page 28).
 */

export type QuestionKind = 'single' | 'multi';

export interface CampaignOption {
  id: string;
  label: string;
  /** "Other (please specify)": choosing it needs a short text answer. */
  other?: boolean;
  /** Choosing it clears every other choice (e.g. "Not applicable"). */
  exclusive?: boolean;
}

export interface CampaignQuestion {
  id: string;
  kind: QuestionKind;
  title: string;
  hint?: string;
  options: CampaignOption[];
}

export interface CampaignDefinition {
  id: string;
  title: string;
  /** Normalised country names (see utils/countries.util normalizeCountry). */
  countries: string[];
  /** Answers accepted from opensAt (inclusive) to closesAt (exclusive). */
  opensAt: Date;
  closesAt: Date;
  /** Gifts can be activated until this moment (exclusive). */
  activateBy: Date;
  giftMonths: number;
  questions: CampaignQuestion[];
}

const SPEND_CHANGE: CampaignOption[] = [
  { id: 'much_more', label: 'Spend significantly more' },
  { id: 'little_more', label: 'Spend a little more' },
  { id: 'same', label: 'Spend about the same' },
  { id: 'little_less', label: 'Spend a little less' },
  { id: 'much_less', label: 'Spend significantly less' },
  { id: 'not_sure', label: 'Not sure' },
];

/**
 * Christmas Food Report 2026. Times are Australian Eastern Daylight Time
 * (UTC+11): open 1–14 December inclusive, activate by 31 December.
 */
export const CHRISTMAS_2026: CampaignDefinition = {
  id: 'christmas-2026',
  title: 'Christmas Food Report',
  countries: ['Australia'],
  opensAt: new Date('2026-11-30T13:00:00.000Z'), // 1 Dec 00:00 AEDT
  closesAt: new Date('2026-12-14T13:00:00.000Z'), // end of 14 Dec AEDT
  activateBy: new Date('2026-12-31T13:00:00.000Z'), // end of 31 Dec AEDT
  giftMonths: 2,
  questions: [
    {
      id: 'food_budget_change',
      kind: 'single',
      title:
        'Compared with last Christmas, how do you expect your household’s Christmas food budget to change?',
      options: SPEND_CHANGE,
    },
    {
      id: 'food_spend',
      kind: 'single',
      title:
        'Approximately how much do you expect your household to spend on Christmas food and drinks this year?',
      options: [
        { id: 'under_100', label: 'Under $100' },
        { id: '100_249', label: '$100 - $249' },
        { id: '250_499', label: '$250 - $499' },
        { id: '500_749', label: '$500 - $749' },
        { id: '750_999', label: '$750 - $999' },
        { id: '1000_plus', label: '$1,000 or more' },
        { id: 'not_sure', label: 'Not sure' },
      ],
    },
    {
      id: 'cost_pressures',
      kind: 'multi',
      title: 'How are cost-of-living pressures influencing your Christmas food plans?',
      hint: 'Select all that apply.',
      options: [
        { id: 'specials', label: 'Buying more specials or discounted products' },
        { id: 'cheaper_brands', label: 'Choosing less expensive food or brands' },
        { id: 'fewer_dishes', label: 'Preparing fewer dishes or smaller quantities' },
        { id: 'guests_contribute', label: 'Asking guests to contribute food' },
        { id: 'fewer_people', label: 'Entertaining fewer people' },
        { id: 'no_changes', label: 'No significant changes' },
        { id: 'other', label: 'Other (please specify)', other: true },
      ],
    },
    {
      id: 'total_spend_change',
      kind: 'single',
      title:
        'Compared with last Christmas, how do you expect your household’s total Christmas spending to change?',
      hint: 'Including food, gifts, decorations, entertainment and other Christmas-related expenses.',
      options: SPEND_CHANGE,
    },
    {
      id: 'budget_plans',
      kind: 'multi',
      title: 'What are you planning to do to make your Christmas food budget go further?',
      hint: 'Select all that apply.',
      options: [
        { id: 'plan_ahead', label: 'Plan my menu and shopping list in advance' },
        { id: 'shop_around', label: 'Shop around for the best prices' },
        { id: 'buy_early', label: 'Buy ingredients early when on special' },
        { id: 'cheaper_alternatives', label: 'Choose cheaper alternatives to traditional dishes' },
        { id: 'use_what_i_have', label: 'Use ingredients I already have' },
        { id: 'share_costs', label: 'Share cooking or food costs with family and friends' },
        { id: 'no_changes', label: 'I don’t plan to make any changes' },
        { id: 'other', label: 'Other (please specify)', other: true },
      ],
    },
    {
      id: 'leftovers',
      kind: 'multi',
      title: 'How do you usually manage food left over after Christmas celebrations?',
      hint: 'Select all that apply.',
      // The design also lists "Buying more specials or discounted products"
      // here, which looks copied from question 3; left out until confirmed.
      options: [
        { id: 'freeze', label: 'Freeze food for later' },
        { id: 'send_home', label: 'Send food home with guests' },
        { id: 'share', label: 'Share extra food with others' },
        { id: 'little_left', label: 'Usually have very little left over' },
        { id: 'struggle', label: 'Often struggle to use everything' },
        { id: 'not_applicable', label: 'Not applicable', exclusive: true },
      ],
    },
  ],
};

export const CAMPAIGNS: Record<string, CampaignDefinition> = {
  [CHRISTMAS_2026.id]: CHRISTMAS_2026,
};
