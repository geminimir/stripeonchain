import crypto from 'crypto';
import Stripe from 'stripe';

export const TEST_WEBHOOK_SECRET = 'whsec_test_integration_secret';
export const TEST_SECRET_KEY = 'sk_test_integration_key';

export function generateStripeSignature(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const signature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function createPaymentIntentPayload(
  overrides: {
    eventId?: string;
    eventType?: string;
    piId?: string;
    amount?: number;
    currency?: string;
    paymentMethodTypes?: string[];
    metadata?: Record<string, string>;
    status?: string;
  } = {},
): Stripe.Event {
  const {
    eventId = `evt_${crypto.randomBytes(12).toString('hex')}`,
    eventType = 'payment_intent.succeeded',
    piId = `pi_${crypto.randomBytes(12).toString('hex')}`,
    amount = 5000,
    currency = 'usd',
    paymentMethodTypes = ['crypto'],
    metadata = { chain: 'ethereum', token: 'usdc' },
    status = 'succeeded',
  } = overrides;

  return {
    id: eventId,
    object: 'event',
    type: eventType,
    api_version: '2026-02-25.clover',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: piId,
        object: 'payment_intent',
        amount,
        currency,
        status,
        payment_method_types: paymentMethodTypes,
        metadata,
        created: Math.floor(Date.now() / 1000),
        client_secret: `${piId}_secret_test`,
        confirmation_method: 'automatic',
        capture_method: 'automatic',
        livemode: false,
      } as unknown as Stripe.PaymentIntent,
    },
  } as Stripe.Event;
}

export const cryptoSucceededPayload = createPaymentIntentPayload({
  eventId: 'evt_crypto_succeeded_001',
  eventType: 'payment_intent.succeeded',
  piId: 'pi_crypto_succeeded_001',
  amount: 5000,
  metadata: { chain: 'ethereum', token: 'usdc' },
});

export const cryptoProcessingPayload = createPaymentIntentPayload({
  eventId: 'evt_crypto_processing_001',
  eventType: 'payment_intent.processing',
  piId: 'pi_crypto_processing_001',
  amount: 10000,
  metadata: { chain: 'base', token: 'usdc' },
  status: 'processing',
});

export const cryptoFailedPayload = createPaymentIntentPayload({
  eventId: 'evt_crypto_failed_001',
  eventType: 'payment_intent.payment_failed',
  piId: 'pi_crypto_failed_001',
  amount: 2500,
  metadata: { chain: 'polygon', token: 'usdc' },
  status: 'requires_payment_method',
});

export const cardSucceededPayload = createPaymentIntentPayload({
  eventId: 'evt_card_001',
  eventType: 'payment_intent.succeeded',
  piId: 'pi_card_001',
  amount: 5000,
  paymentMethodTypes: ['card'],
  metadata: {},
});

export const chargeSucceededPayload: Stripe.Event = {
  id: 'evt_charge_001',
  object: 'event',
  type: 'charge.succeeded',
  api_version: '2026-02-25.clover',
  created: Math.floor(Date.now() / 1000),
  livemode: false,
  pending_webhooks: 0,
  request: { id: null, idempotency_key: null },
  data: {
    object: {
      id: 'ch_test_001',
      object: 'charge',
      amount: 5000,
      currency: 'usd',
    } as unknown as Stripe.Charge,
  },
} as Stripe.Event;

export function createUniquePayload(
  chain: 'ethereum' | 'base' | 'polygon' | 'solana' = 'ethereum',
): {
  payload: Stripe.Event;
  json: string;
  signature: string;
} {
  const payload = createPaymentIntentPayload({
    metadata: { chain, token: 'usdc' },
  });
  const json = JSON.stringify(payload);
  const signature = generateStripeSignature(json, TEST_WEBHOOK_SECRET);
  return { payload, json, signature };
}

export function signPayload(payload: Stripe.Event): { json: string; signature: string } {
  const json = JSON.stringify(payload);
  const signature = generateStripeSignature(json, TEST_WEBHOOK_SECRET);
  return { json, signature };
}
