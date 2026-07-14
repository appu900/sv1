import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { PerksApiClient } from './perks-api-client';

class LiveRedisStub {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  async set(key: string, value: unknown) {
    this.values.set(key, value);
  }

  async del(key: string) {
    this.values.delete(key);
  }

  async setIfAbsent(key: string, value: string) {
    if (this.values.has(key)) return false;
    this.values.set(key, value);
    return true;
  }

  async releaseLock(key: string, value: string) {
    if (this.values.get(key) !== value) return false;
    this.values.delete(key);
    return true;
  }
}

const liveDescribe =
  process.env.WMAD_LIVE_TESTS === 'true' ? describe : describe.skip;
const liveRegistrationIt =
  process.env.WMAD_LIVE_REGISTER === 'true' ? it : it.skip;
const livePurchaseIt =
  process.env.WMAD_LIVE_PURCHASE_APPROVED === 'true' ? it : it.skip;

liveDescribe('WMAD live integration', () => {
  const client = new PerksApiClient(
    new ConfigService(process.env),
    new LiveRedisStub() as never,
  );

  it('authenticates and reads the live e-card catalogue', async () => {
    const connection = await client.verifyConnection();
    expect(connection.authenticated).toBe(true);
    const cards = await client.getEcards();
    expect(Array.isArray(cards)).toBe(true);
  }, 30_000);

  liveRegistrationIt(
    'registers the designated real Saveful user',
    async () => {
      const required = [
        'WMAD_LIVE_FIRST_NAME',
        'WMAD_LIVE_LAST_NAME',
        'WMAD_LIVE_USER_EMAIL',
        'WMAD_LIVE_POSTCODE',
      ] as const;
      for (const key of required) {
        if (!process.env[key]) throw new Error(`${key} is required`);
      }
      const result = await client.registerUser({
        firstname: process.env.WMAD_LIVE_FIRST_NAME!,
        lastname: process.env.WMAD_LIVE_LAST_NAME!,
        email: process.env.WMAD_LIVE_USER_EMAIL!,
        postcode: process.env.WMAD_LIVE_POSTCODE!,
      });
      expect(result.user_id).toBeDefined();
    },
    30_000,
  );

  livePurchaseIt(
    'places one explicitly approved real gift-card order',
    async () => {
      const ecardId = process.env.WMAD_LIVE_ECARD_ID;
      const ecardValue = Number(process.env.WMAD_LIVE_ECARD_VALUE);
      if (!ecardId || !Number.isFinite(ecardValue) || ecardValue <= 0) {
        throw new Error(
          'WMAD_LIVE_ECARD_ID and WMAD_LIVE_ECARD_VALUE are required',
        );
      }
      const orderReference =
        `SVLIVE${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
          .replace(/[^A-Za-z0-9]/g, '')
          .slice(0, 50);
      const order = await client.createOrder({
        ecard_id: ecardId,
        ecard_value: ecardValue,
        ecard_qty: 1,
        order_reference: orderReference,
        ecard_sendasgift: 0,
      });
      expect(order.order_number).toBeDefined();

      const orderNumber = String(order.order_number);
      const detail = await client.getOrderDetail(orderNumber);
      expect(detail).toBeDefined();

      if (process.env.WMAD_LIVE_RECEIPT_APPROVED === 'true') {
        await expect(client.getTaxReceipt(orderNumber)).resolves.toBeDefined();
      }
      if (process.env.WMAD_LIVE_CANCEL_APPROVED === 'true') {
        await expect(client.cancelOrder(orderNumber)).resolves.toBeDefined();
      }
    },
    60_000,
  );
});
