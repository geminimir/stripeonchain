import Stripe from 'stripe';
import { processStripeEvent } from '../event-processor';
import { EventStore, InsertableEvent } from '../event-store';

class InMemoryEventStore implements EventStore {
  events: InsertableEvent[] = [];
  private seenIds = new Set<string>();

  async insertEvent(event: InsertableEvent): Promise<void> {
    this.seenIds.add(event.event_id);
    this.events.push(event);
  }

  async eventExists(eventId: string): Promise<boolean> {
    return this.seenIds.has(eventId);
  }
}

function makeCryptoPaymentEvent(overrides: Partial<Stripe.Event> = {}): Stripe.Event {
  return {
    id: 'evt_crypto_001',
    object: 'event',
    type: 'payment_intent.succeeded',
    api_version: '2026-02-25.clover',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: 'pi_crypto_001',
        object: 'payment_intent',
        amount: 5000,
        currency: 'usd',
        payment_method_types: ['crypto'],
        metadata: {
          chain: 'ethereum',
          token: 'usdc',
        },
      } as unknown as Stripe.PaymentIntent,
    },
    ...overrides,
  } as Stripe.Event;
}

function makeCardPaymentEvent(): Stripe.Event {
  return makeCryptoPaymentEvent({
    id: 'evt_card_001',
    data: {
      object: {
        id: 'pi_card_001',
        object: 'payment_intent',
        amount: 5000,
        currency: 'usd',
        payment_method_types: ['card'],
        metadata: {},
      } as unknown as Stripe.PaymentIntent,
    },
  });
}

describe('processStripeEvent', () => {
  let store: InMemoryEventStore;

  beforeEach(() => {
    store = new InMemoryEventStore();
  });

  it('processes and stores a crypto payment_intent.succeeded event', async () => {
    const event = makeCryptoPaymentEvent();

    const result = await processStripeEvent(event, store);

    expect(result).toEqual({ processed: true });
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({
      event_id: 'evt_crypto_001',
      event_type: 'payment_intent.succeeded',
      payment_intent_id: 'pi_crypto_001',
      amount: '50000000',
      currency: 'usd',
      payment_method_type: 'crypto',
      chain_hint: 'ethereum',
      token_hint: 'usdc',
    });
  });

  it('ignores card payment_intent.succeeded events', async () => {
    const event = makeCardPaymentEvent();

    const result = await processStripeEvent(event, store);

    expect(result).toEqual({ processed: false, reason: 'not_crypto_payment' });
    expect(store.events).toHaveLength(0);
  });

  it('silently drops duplicate event IDs (idempotent)', async () => {
    const event = makeCryptoPaymentEvent();

    const first = await processStripeEvent(event, store);
    const second = await processStripeEvent(event, store);

    expect(first).toEqual({ processed: true });
    expect(second).toEqual({ processed: false, reason: 'duplicate_event' });
    expect(store.events).toHaveLength(1);
  });

  it('ignores non-payment_intent event types', async () => {
    const event = makeCryptoPaymentEvent({ type: 'charge.succeeded' } as Partial<Stripe.Event>);

    const result = await processStripeEvent(event, store);

    expect(result).toEqual({ processed: false, reason: 'event_type_not_accepted' });
    expect(store.events).toHaveLength(0);
  });

  it('processes payment_intent.processing events', async () => {
    const event = makeCryptoPaymentEvent({ type: 'payment_intent.processing' });

    const result = await processStripeEvent(event, store);

    expect(result).toEqual({ processed: true });
    expect(store.events[0].event_type).toBe('payment_intent.processing');
  });

  it('processes payment_intent.payment_failed events', async () => {
    const event = makeCryptoPaymentEvent({ type: 'payment_intent.payment_failed' });

    const result = await processStripeEvent(event, store);

    expect(result).toEqual({ processed: true });
    expect(store.events[0].event_type).toBe('payment_intent.payment_failed');
  });

  it('sets chain_hint to null for unknown chains', async () => {
    const event = makeCryptoPaymentEvent({
      data: {
        object: {
          id: 'pi_crypto_002',
          object: 'payment_intent',
          amount: 1000,
          currency: 'usd',
          payment_method_types: ['crypto'],
          metadata: { chain: 'avalanche', token: 'usdc' },
        } as unknown as Stripe.PaymentIntent,
      },
    });

    const result = await processStripeEvent(event, store);

    expect(result).toEqual({ processed: true });
    expect(store.events[0].chain_hint).toBeNull();
  });

  it('converts Stripe cents to microUSDC correctly', async () => {
    const event = makeCryptoPaymentEvent({
      data: {
        object: {
          id: 'pi_crypto_003',
          object: 'payment_intent',
          amount: 100,
          currency: 'usd',
          payment_method_types: ['crypto'],
          metadata: {},
        } as unknown as Stripe.PaymentIntent,
      },
    });

    const result = await processStripeEvent(event, store);

    expect(result).toEqual({ processed: true });
    expect(store.events[0].amount).toBe('1000000');
  });
});
