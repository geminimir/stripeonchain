import Redis from 'ioredis';
import { REDIS_STREAMS, SupportedChain } from '@stripeonchain/shared';

export interface StreamMessage {
  event_id: string;
  payment_intent_id: string;
  amount: string;
  chain: SupportedChain | null;
  token: string | null;
  timestamp: string;
}

export interface EventPublisher {
  publish(message: StreamMessage): Promise<boolean>;
  isPublished(eventId: string): Promise<boolean>;
  close(): Promise<void>;
}

const DEDUP_SET_KEY = 'stripe-events:published';
const DEDUP_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export class RedisEventPublisher implements EventPublisher {
  private redis: Redis;
  private streamKey: string;

  constructor(redis: Redis, streamKey: string = REDIS_STREAMS.STRIPE_EVENTS) {
    this.redis = redis;
    this.streamKey = streamKey;
  }

  async publish(message: StreamMessage): Promise<boolean> {
    const alreadyPublished = await this.isPublished(message.event_id);
    if (alreadyPublished) {
      return false;
    }

    const fields: string[] = [
      'event_id',
      message.event_id,
      'payment_intent_id',
      message.payment_intent_id,
      'amount',
      message.amount,
      'chain',
      message.chain ?? '',
      'token',
      message.token ?? '',
      'timestamp',
      message.timestamp,
    ];

    await this.redis.xadd(this.streamKey, '*', ...fields);
    await this.redis.setex(`${DEDUP_SET_KEY}:${message.event_id}`, DEDUP_TTL_SECONDS, '1');

    return true;
  }

  async isPublished(eventId: string): Promise<boolean> {
    const exists = await this.redis.exists(`${DEDUP_SET_KEY}:${eventId}`);
    return exists === 1;
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
