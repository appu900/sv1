
export function currentPeriod(now: Date = new Date()): {
  periodKey: string;
  periodStart: Date;
  periodEnd: Date;
} {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const periodStart = new Date(Date.UTC(year, month, 1));
  const periodEnd = new Date(Date.UTC(year, month + 1, 1));
  const mm = String(month + 1).padStart(2, '0');
  return {
    periodKey: `${year}-${mm}`,
    periodStart,
    periodEnd,
  };
}
