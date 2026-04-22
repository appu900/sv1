type Pricing = { input: number; output: number };

const PRICING_TABLE: Array<[string, Pricing]> = [
  ['gpt-4o-mini', { input: 0.15, output: 0.6 }],
  ['gpt-4o', { input: 2.5, output: 10.0 }],
  ['gpt-4.1-nano', { input: 0.1, output: 0.4 }],
  ['gpt-4.1-mini', { input: 0.4, output: 1.6 }],
  ['gpt-4.1', { input: 2.0, output: 8.0 }],
  ['gpt-5-mini', { input: 0.25, output: 2.0 }],
  ['gpt-5', { input: 1.25, output: 10.0 }],
  ['o4-mini', { input: 1.1, output: 4.4 }],
  ['o3', { input: 2.0, output: 8.0 }],
];

export function resolvePricing(model: string | undefined | null): Pricing | null {
  if (!model) return null;
  const key = model.toLowerCase();
  for (const [prefix, price] of PRICING_TABLE) {
    if (key.startsWith(prefix)) return price;
  }
  return null;
}

export function computeCostUsd(
  model: string | undefined | null,
  promptTokens: number,
  completionTokens: number,
): number {
  const price = resolvePricing(model);
  if (!price) return 0;
  const cost =
    (promptTokens / 1_000_000) * price.input +
    (completionTokens / 1_000_000) * price.output;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export interface AggregatedCall {
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface AggregatedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export function aggregateUsage(calls: AggregatedCall[]): AggregatedUsage {
  let promptTokens = 0;
  let completionTokens = 0;
  let costUsd = 0;
  for (const c of calls) {
    promptTokens += c.promptTokens;
    completionTokens += c.completionTokens;
    costUsd += computeCostUsd(c.model, c.promptTokens, c.completionTokens);
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
  };
}

export function extractUsage(response: any): { promptTokens: number; completionTokens: number } {
  const usage = response?.usage ?? {};
  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
  const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
  return { promptTokens, completionTokens };
}
