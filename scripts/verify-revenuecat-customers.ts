import 'reflect-metadata';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { SubscriptionService } from '../src/modules/subscription/subscription.service';
import { parseCustomerInfo } from '../src/modules/subscription/utils/parse-customer-info';
import { currentUsagePeriod } from '../src/modules/subscription/utils/period';
import { SAVEFUL_ENTITLEMENT } from '../src/modules/subscription/subscription.constants';

const SCREENSHOT_CUSTOMER_IDS = [
  '69abda666064034999a00940',
  '698c1ffc6a7c3806736a1bd4',
  '69f1416935a72997aa0339a5',
];

function loadEnvFile(path = resolve(process.cwd(), '.env')): Record<string, string> {
  if (!existsSync(path)) return {};
  const env: Record<string, string> = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function formatDate(value: Date | undefined): string {
  return value ? value.toISOString() : '-';
}

function formatValue(value: unknown): string {
  if (value == null || value === '') return '-';
  return String(value);
}

async function main() {
  const envFile = loadEnvFile();
  const env = {
    ...envFile,
    ...process.env,
  } as Record<string, string | undefined>;
  const customerIds = process.argv.slice(2);
  const ids = customerIds.length > 0 ? customerIds : SCREENSHOT_CUSTOMER_IDS;

  const service = new SubscriptionService(
    {} as any,
    {} as any,
    { get: (key: string) => env[key] } as any,
  );

  for (const id of ids) {
    const customerInfo = await (service as any).verifyCustomerWithRevenueCat(
      id,
      { throwOnFailure: true },
    );
    const parsed = parseCustomerInfo(customerInfo);
    const entitlement =
      customerInfo?.entitlements?.active?.[SAVEFUL_ENTITLEMENT] ??
      customerInfo?.entitlements?.[SAVEFUL_ENTITLEMENT];
    const period = currentUsagePeriod(parsed, new Date());

    console.log(`\nCustomer ${id}`);
    console.log(`  originalAppUserId: ${formatValue(customerInfo?.originalAppUserId)}`);
    console.log(`  activeEntitlement: ${entitlement ? SAVEFUL_ENTITLEMENT : 'none'}`);
    console.log(`  productId: ${formatValue(parsed.productId)}`);
    console.log(`  parsedPlan: ${parsed.plan}`);
    console.log(`  status: ${parsed.status}`);
    console.log(`  periodType: ${formatValue(parsed.periodType)}`);
    console.log(`  store: ${formatValue(parsed.store)}`);
    console.log(`  willRenew: ${parsed.willRenew}`);
    console.log(`  trialCancelled: ${!!parsed.trialCancelled}`);
    console.log(`  purchasedAt: ${formatDate(parsed.purchasedAt)}`);
    console.log(`  expiresAt: ${formatDate(parsed.expiresAt)}`);
    console.log(`  trialEndsAt: ${formatDate(parsed.trialEndsAt)}`);
    console.log(`  cancelledAt: ${formatDate(parsed.cancelledAt)}`);
    console.log(`  usagePeriod: ${period.periodKey} (${period.periodStart.toISOString()} -> ${period.periodEnd.toISOString()})`);
  }
}

main().catch((err: Error) => {
  console.error(`RevenueCat verification failed: ${err.message}`);
  process.exitCode = 1;
});
