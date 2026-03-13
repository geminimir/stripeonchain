import Stripe from 'stripe';
import { processStripeEvent } from '../event-processor';
import { EventStore, InsertableEvent } from '../event-store';
import { EventPublisher, StreamMessage } from '../event-publisher';

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

class InMemoryEventPublisher implements EventPublisher {
  messages: StreamMessage[] = [];
  private publishedIds = new Set<string>();
  shouldFail = false;

  async publish(message: StreamMessage): Promise<boolean> {
    if (this.shouldFail) {
      throw new Error('Redis connection failed');
    }
    if (this.publishedIds.has(message.event_id)) {
      return false;
    }
    this.publishedIds.add(message.event_id);
    this.messages.push(message);
    return true;
  }

  async isPublished(eventId: string): Promise<boolean> {
    return this.publishedIds.has(eventId);
  }

  async close(): Promise<void> {}
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

    const result = await processStripeEvent(event, { store });

    expect(result.processed).toBe(true);
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

    const result = await processStripeEvent(event, { store });

    expect(result).toEqual({ processed: false, reason: 'not_crypto_payment' });
    expect(store.events).toHaveLength(0);
  });

  it('silently drops duplicate event IDs (idempotent)', async () => {
    const event = makeCryptoPaymentEvent();

    const first = await processStripeEvent(event, { store });
    const second = await processStripeEvent(event, { store });

    expect(first.processed).toBe(true);
    expect(second).toEqual({ processed: false, reason: 'duplicate_event' });
    expect(store.events).toHaveLength(1);
  });

  it('ignores non-payment_intent event types', async () => {
    const event = makeCryptoPaymentEvent({ type: 'charge.succeeded' } as Partial<Stripe.Event>);

    const result = await processStripeEvent(event, { store });

    expect(result).toEqual({ processed: false, reason: 'event_type_not_accepted' });
    expect(store.events).toHaveLength(0);
  });

  it('processes payment_intent.processing events', async () => {
    const event = makeCryptoPaymentEvent({ type: 'payment_intent.processing' });

    const result = await processStripeEvent(event, { store });

    expect(result.processed).toBe(true);
    expect(store.events[0].event_type).toBe('payment_intent.processing');
  });

  it('processes payment_intent.payment_failed events', async () => {
    const event = makeCryptoPaymentEvent({ type: 'payment_intent.payment_failed' });

    const result = await processStripeEvent(event, { store });

    expect(result.processed).toBe(true);
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

    const result = await processStripeEvent(event, { store });

    expect(result.processed).toBe(true);
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

    const result = await processStripeEvent(event, { store });

    expect(result.processed).toBe(true);
    expect(store.events[0].amount).toBe('1000000');
  });
});

describe('processStripeEvent with publisher', () => {
  let store: InMemoryEventStore;
  let publisher: InMemoryEventPublisher;

  beforeEach(() => {
    store = new InMemoryEventStore();
    publisher = new InMemoryEventPublisher();
  });

  it('publishes event to Redis Stream after ingestion', async () => {
    const event = makeCryptoPaymentEvent();

    const result = await processStripeEvent(event, { store, publisher });

    expect(result).toMatchObject({ processed: true, published: true });
    expect(publisher.messages).toHaveLength(1);
    expect(publisher.messages[0]).toMatchObject({
      event_id: 'evt_crypto_001',
      payment_intent_id: 'pi_crypto_001',
      amount: '50000000',
      chain: 'ethereum',
      token: 'usdc',
    });
  });

  it('does not re-publish duplicate events', async () => {
    const event = makeCryptoPaymentEvent();

    await processStripeEvent(event, { store, publisher });

    store = new InMemoryEventStore();
    const event2 = makeCryptoPaymentEvent({ id: 'evt_crypto_002' });
    (event2.data.object as Stripe.PaymentIntent).id = 'pi_crypto_002';

    const secondResult = await processStripeEvent(event2, { store, publisher });

    expect(secondResult).toMatchObject({ processed: true, published: true });
    expect(publisher.messages).toHaveLength(2);

    publisher.messages = [];
    const thirdResult = await processStripeEvent(event2, { store, publisher });
    expect(thirdResult).toEqual({ processed: false, reason: 'duplicate_event' });
    expect(publisher.messages).toHaveLength(0);
  });

  it('handles Redis connection failure gracefully', async () => {
    const event = makeCryptoPaymentEvent();
    publisher.shouldFail = true;

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const result = await processStripeEvent(event, { store, publisher });

    expect(result).toMatchObject({ processed: true, published: false });
    expect(store.events).toHaveLength(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to publish event'),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  it('works without publisher (backward compatible)', async () => {
    const event = makeCryptoPaymentEvent();

    const result = await processStripeEvent(event, { store });

    expect(result).toMatchObject({ processed: true, published: false });
    expect(store.events).toHaveLength(1);
  });
});
