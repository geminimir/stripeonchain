import request from 'supertest';
import { createWebhookApp } from '../webhook';
import { PostgresEventStore } from './helpers/postgres-event-store';
import {
  TEST_WEBHOOK_SECRET,
  TEST_SECRET_KEY,
  cryptoSucceededPayload,
  cryptoProcessingPayload,
  cryptoFailedPayload,
  cardSucceededPayload,
  chargeSucceededPayload,
  signPayload,
  createUniquePayload,
} from './fixtures/stripe-payloads';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgres://stripeonchain:stripeonchain_dev@localhost:5432/stripeonchain';

describe('Stripe Listener Integration Tests', () => {
  let eventStore: PostgresEventStore;
  let app: ReturnType<typeof createWebhookApp>;

  beforeAll(async () => {
    eventStore = new PostgresEventStore(TEST_DATABASE_URL);
    app = createWebhookApp({
      stripeSecretKey: TEST_SECRET_KEY,
      stripeWebhookSecret: TEST_WEBHOOK_SECRET,
      eventStore,
    });
  });

  afterAll(async () => {
    await eventStore.close();
  });

  beforeEach(async () => {
    await eventStore.clearEvents();
  });

  describe('Full lifecycle: HTTP request → signature verification → DB insert', () => {
    it('processes a crypto payment_intent.succeeded event end-to-end', async () => {
      const { json, signature } = signPayload(cryptoSucceededPayload);

      const res = await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(json);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        received: true,
        type: 'payment_intent.succeeded',
        processed: true,
      });

      const stored = await eventStore.getEvent('evt_crypto_succeeded_001');
      expect(stored).not.toBeNull();
      expect(stored).toMatchObject({
        event_id: 'evt_crypto_succeeded_001',
        event_type: 'payment_intent.succeeded',
        payment_intent_id: 'pi_crypto_succeeded_001',
        amount: '50000000',
        currency: 'usd',
        payment_method_type: 'crypto',
        chain_hint: 'ethereum',
        token_hint: 'usdc',
      });
    });

    it('processes a crypto payment_intent.processing event end-to-end', async () => {
      const { json, signature } = signPayload(cryptoProcessingPayload);

      const res = await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(json);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        received: true,
        type: 'payment_intent.processing',
        processed: true,
      });

      const stored = await eventStore.getEvent('evt_crypto_processing_001');
      expect(stored).not.toBeNull();
      expect(stored?.event_type).toBe('payment_intent.processing');
      expect(stored?.chain_hint).toBe('base');
      expect(stored?.amount).toBe('100000000');
    });

    it('processes a crypto payment_intent.payment_failed event end-to-end', async () => {
      const { json, signature } = signPayload(cryptoFailedPayload);

      const res = await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(json);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        received: true,
        type: 'payment_intent.payment_failed',
        processed: true,
      });

      const stored = await eventStore.getEvent('evt_crypto_failed_001');
      expect(stored).not.toBeNull();
      expect(stored?.event_type).toBe('payment_intent.payment_failed');
      expect(stored?.chain_hint).toBe('polygon');
    });
  });

  describe('Idempotent re-delivery of same event', () => {
    it('inserts the event only once when delivered multiple times', async () => {
      const { payload, json, signature } = createUniquePayload('ethereum');
      const eventId = payload.id;

      const res1 = await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(json);

      expect(res1.status).toBe(200);
      expect(res1.body.processed).toBe(true);

      const countAfterFirst = await eventStore.countEvents();
      expect(countAfterFirst).toBe(1);

      const res2 = await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(json);

      expect(res2.status).toBe(200);
      expect(res2.body).toMatchObject({
        received: true,
        processed: false,
        reason: 'duplicate_event',
      });

      const countAfterSecond = await eventStore.countEvents();
      expect(countAfterSecond).toBe(1);

      const stored = await eventStore.getEvent(eventId);
      expect(stored).not.toBeNull();
    });

    it('handles concurrent re-deliveries gracefully', async () => {
      const { json, signature } = createUniquePayload('base');

      const requests = Array(5)
        .fill(null)
        .map(() =>
          request(app)
            .post('/webhooks/stripe')
            .set('Content-Type', 'application/json')
            .set('stripe-signature', signature)
            .send(json),
        );

      const results = await Promise.allSettled(requests);

      const successfulResponses = results.filter(
        (r) => r.status === 'fulfilled' && r.value.status === 200,
      );
      expect(successfulResponses.length).toBe(5);

      const processedCount = results.filter(
        (r) => r.status === 'fulfilled' && r.value.body.processed === true,
      ).length;
      expect(processedCount).toBe(1);

      const count = await eventStore.countEvents();
      expect(count).toBe(1);
    });
  });

  describe('Non-crypto event filtering', () => {
    it('acknowledges but does not store card payment events', async () => {
      const { json, signature } = signPayload(cardSucceededPayload);

      const res = await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(json);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        received: true,
        type: 'payment_intent.succeeded',
        processed: false,
        reason: 'not_crypto_payment',
      });

      const stored = await eventStore.getEvent('evt_card_001');
      expect(stored).toBeNull();

      const count = await eventStore.countEvents();
      expect(count).toBe(0);
    });

    it('acknowledges but does not store non-payment_intent events', async () => {
      const { json, signature } = signPayload(chargeSucceededPayload);

      const res = await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(json);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        received: true,
        type: 'charge.succeeded',
        processed: false,
        reason: 'event_type_not_accepted',
      });

      const stored = await eventStore.getEvent('evt_charge_001');
      expect(stored).toBeNull();

      const count = await eventStore.countEvents();
      expect(count).toBe(0);
    });
  });

  describe('Signature verification', () => {
    it('rejects requests with invalid signature', async () => {
      const { json } = signPayload(cryptoSucceededPayload);
      const invalidSignature = 't=1234567890,v1=invalidsignature';

      const res = await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', invalidSignature)
        .send(json);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Webhook signature verification failed/);

      const count = await eventStore.countEvents();
      expect(count).toBe(0);
    });

    it('rejects requests with missing signature', async () => {
      const { json } = signPayload(cryptoSucceededPayload);

      const res = await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .send(json);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Missing stripe-signature header');

      const count = await eventStore.countEvents();
      expect(count).toBe(0);
    });

    it('rejects tampered payloads', async () => {
      const { json, signature } = signPayload(cryptoSucceededPayload);
      const tamperedJson = json.replace('"amount":5000', '"amount":999999');

      const res = await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(tamperedJson);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Webhook signature verification failed/);

      const count = await eventStore.countEvents();
      expect(count).toBe(0);
    });
  });

  describe('Data transformation', () => {
    it('correctly converts Stripe cents to microUSDC', async () => {
      const { payload, json, signature } = createUniquePayload('ethereum');

      const res = await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(json);

      expect(res.status).toBe(200);
      expect(res.body.processed).toBe(true);

      const stored = await eventStore.getEvent(payload.id);
      expect(stored).not.toBeNull();
      expect(stored?.amount).toBe('50000000');
    });

    it('stores the full payload as JSON', async () => {
      const { payload, json, signature } = createUniquePayload('ethereum');

      await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(json);

      const stored = await eventStore.getEvent(payload.id);
      expect(stored).not.toBeNull();
      expect(stored?.payload).toBeDefined();
      expect(stored?.payload).toHaveProperty('id');
      expect(stored?.payload).toHaveProperty('amount');
    });
  });
});
