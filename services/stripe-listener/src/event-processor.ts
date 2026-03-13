import Stripe from 'stripe';
import { SupportedChain, USDC_DECIMALS } from '@stripeonchain/shared';
import { EventStore, InsertableEvent } from './event-store';

const ACCEPTED_EVENT_TYPES = new Set([
  'payment_intent.succeeded',
  'payment_intent.processing',
  'payment_intent.payment_failed',
]);

const CRYPTO_PAYMENT_METHOD_TYPES = new Set(['crypto']);

const VALID_CHAINS = new Set<string>(['ethereum', 'base', 'polygon', 'solana']);

/**
 * Stripe amounts are in smallest currency unit (cents for USD).
 * microUSDC = cents * 10^(USDC_DECIMALS - 2) = cents * 10_000
 */
function centsToMicroUsdc(cents: number): string {
  const factor = Math.pow(10, USDC_DECIMALS - 2);
  return String(cents * factor);
}

function parseChainHint(metadata: Record<string, string> | undefined): SupportedChain | null {
  const chain = metadata?.chain;
  if (chain && VALID_CHAINS.has(chain)) {
    return chain as SupportedChain;
  }
  return null;
}

export interface ProcessResult {
  processed: boolean;
  reason?: string;
}

export async function processStripeEvent(
  event: Stripe.Event,
  store: EventStore,
): Promise<ProcessResult> {
  if (!ACCEPTED_EVENT_TYPES.has(event.type)) {
    return { processed: false, reason: 'event_type_not_accepted' };
  }

  const paymentIntent = event.data.object as Stripe.PaymentIntent;

  const paymentMethodTypes: string[] = paymentIntent.payment_method_types ?? [];
  const hasCrypto = paymentMethodTypes.some((t) => CRYPTO_PAYMENT_METHOD_TYPES.has(t));
  if (!hasCrypto) {
    return { processed: false, reason: 'not_crypto_payment' };
  }

  const isDuplicate = await store.eventExists(event.id);
  if (isDuplicate) {
    return { processed: false, reason: 'duplicate_event' };
  }

  const metadata = (paymentIntent.metadata ?? {}) as Record<string, string>;

  const parsed: InsertableEvent = {
    event_id: event.id,
    event_type: event.type,
    payment_intent_id: paymentIntent.id,
    amount: centsToMicroUsdc(paymentIntent.amount ?? 0),
    currency: paymentIntent.currency ?? 'usd',
    payment_method_type: 'crypto',
    chain_hint: parseChainHint(metadata),
    token_hint: metadata.token ?? null,
    payload: event.data.object as unknown as Record<string, unknown>,
  };

  await store.insertEvent(parsed);

  return { processed: true };
}
