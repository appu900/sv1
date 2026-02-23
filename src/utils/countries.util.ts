const CODE_TO_NAME: Record<string, string> = {
  IN: 'India',
  US: 'United States',
  GB: 'United Kingdom',
  AU: 'Australia',
  CA: 'Canada',
  CN: 'China',
  JP: 'Japan',
  KR: 'South Korea',
  SG: 'Singapore',
  AE: 'United Arab Emirates',
  DE: 'Germany',
  FR: 'France',
  NZ: 'New Zealand',
};

const NAME_TO_CANONICAL = Object.fromEntries(
  Object.values(CODE_TO_NAME).map((name) => [name.toLowerCase(), name]),
);

export function normalizeCountry(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();

  const byCode = CODE_TO_NAME[trimmed.toUpperCase()];
  if (byCode) return byCode;

  const byName = NAME_TO_CANONICAL[trimmed.toLowerCase()];
  if (byName) return byName;

  return trimmed;
}
