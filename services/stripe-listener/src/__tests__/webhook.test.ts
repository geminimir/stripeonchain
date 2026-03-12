import crypto from 'crypto';
import request from 'supertest';
import { createWebhookApp } from '../webhook';

const TEST_SECRET_KEY = 'sk_test_fake_key_for_testing';
const TEST_WEBHOOK_SECRET = 'whsec_test_secret';

function generateStripeSignature(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const signature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

const app = createWebhookApp({
  stripeSecretKey: TEST_SECRET_KEY,
  stripeWebhookSecret: TEST_WEBHOOK_SECRET,
});

const validPayload = JSON.stringify({
  id: 'evt_test_123',
  object: 'event',
  type: 'payment_intent.succeeded',
  data: { object: { id: 'pi_test_123', amount: 1000 } },
});

describe('POST /webhooks/stripe', () => {
  it('returns 200 for a valid signature', async () => {
    const signature = generateStripeSignature(validPayload, TEST_WEBHOOK_SECRET);

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      received: true,
      type: 'payment_intent.succeeded',
    });
  });

  it('returns 400 for a tampered payload', async () => {
    const signature = generateStripeSignature(validPayload, TEST_WEBHOOK_SECRET);
    const tamperedPayload = JSON.stringify({
      id: 'evt_test_123',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test_123', amount: 999999 } },
    });

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(tamperedPayload);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Webhook signature verification failed/);
  });

  it('returns 400 when stripe-signature header is missing', async () => {
    const res = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(validPayload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing stripe-signature header');
  });
});
