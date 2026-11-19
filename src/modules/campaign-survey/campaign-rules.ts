import type { SubscriptionPlan } from '../subscription/subscription.constants';
import type { CampaignDefinition } from './campaigns';

/** Pure rules for campaign surveys, kept apart from Nest for testing. */

export interface SubmittedAnswer {
  questionId: string;
  selected: string[];
  other?: string;
}

export interface StoredAnswer extends SubmittedAnswer {
  /** Option labels at the time of answering, for exports. */
  labels: string[];
}

export type Ineligible = 'not_open' | 'closed' | 'country';

export const OTHER_MAX_LENGTH = 200;

export function windowState(
  campaign: CampaignDefinition,
  now: Date,
): 'not_open' | 'open' | 'closed' {
  if (now < campaign.opensAt) return 'not_open';
  if (now >= campaign.closesAt) return 'closed';
  return 'open';
}

/**
 * Why a user can't answer right now, or null when they can. `bypass` is for
 * QA accounts (env CAMPAIGN_SURVEY_TEST_USER_IDS): it skips dates and country.
 */
export function answerBlocker(
  campaign: CampaignDefinition,
  input: { now: Date; country?: string | null; bypass?: boolean },
): Ineligible | null {
  if (input.bypass) return null;
  const state = windowState(campaign, input.now);
  if (state !== 'open') return state;
  if (!input.country || !campaign.countries.includes(input.country)) return 'country';
  return null;
}

export function canActivate(
  campaign: CampaignDefinition,
  now: Date,
  bypass = false,
): boolean {
  return bypass || now < campaign.activateBy;
}

/**
 * Checks a full set of answers. Returns the stored form, or a message for
 * the first problem found.
 */
export function validateAnswers(
  campaign: CampaignDefinition,
  submitted: unknown,
): { ok: true; answers: StoredAnswer[] } | { ok: false; error: string } {
  if (!Array.isArray(submitted)) return { ok: false, error: 'Answers are missing.' };
  const byId = new Map<string, SubmittedAnswer>();
  for (const raw of submitted) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'An answer is malformed.' };
    const a = raw as Partial<SubmittedAnswer>;
    if (typeof a.questionId !== 'string') return { ok: false, error: 'An answer is malformed.' };
    if (byId.has(a.questionId)) return { ok: false, error: `Question ${a.questionId} was answered twice.` };
    byId.set(a.questionId, {
      questionId: a.questionId,
      selected: Array.isArray(a.selected) ? a.selected.filter(s => typeof s === 'string') : [],
      other: typeof a.other === 'string' ? a.other : undefined,
    });
  }
  const out: StoredAnswer[] = [];
  for (const question of campaign.questions) {
    const answer = byId.get(question.id);
    if (!answer || !answer.selected.length) {
      return { ok: false, error: `Please answer: ${question.title}` };
    }
    const selected = [...new Set(answer.selected)];
    const options = selected.map(id => question.options.find(o => o.id === id));
    if (options.some(o => !o)) return { ok: false, error: `Unknown choice for: ${question.title}` };
    if (question.kind === 'single' && selected.length !== 1) {
      return { ok: false, error: `Choose one answer for: ${question.title}` };
    }
    if (selected.length > 1 && options.some(o => o!.exclusive)) {
      return { ok: false, error: `“${options.find(o => o!.exclusive)!.label}” can’t be combined with other answers.` };
    }
    const wantsOther = options.some(o => o!.other);
    const other = answer.other?.trim() ?? '';
    if (wantsOther && !other) return { ok: false, error: 'Please tell us a little more for “Other”.' };
    if (other.length > OTHER_MAX_LENGTH) return { ok: false, error: '“Other” is too long.' };
    out.push({
      questionId: question.id,
      selected,
      labels: options.map(o => o!.label),
      ...(wantsOther ? { other } : {}),
    });
  }
  for (const id of byId.keys()) {
    if (!campaign.questions.some(q => q.id === id)) return { ok: false, error: `Unknown question ${id}.` };
  }
  return { ok: true, answers: out };
}

/**
 * The thank-you gift for someone on `storePlan` (their store plan, not
 * counting any gift): free users get Hero; paying Hero members get Legend,
 * because a store subscription keeps billing either way; Legend gets a
 * thank-you only.
 */
export function giftFor(storePlan: SubscriptionPlan): 'hero' | 'legend' | null {
  if (storePlan === 'basic') return 'hero';
  if (storePlan === 'hero') return 'legend';
  return null;
}

/** `months` calendar months later, keeping the time; the 31st falls back to the month's last day. */
export function addCalendarMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}
