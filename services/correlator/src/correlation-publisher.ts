import Redis from 'ioredis';
import { REDIS_STREAMS, CorrelationResult, CorrelationCandidate } from '@stripeonchain/shared';

export interface CorrelationPublisher {
  publish(result: CorrelationResult): Promise<string>;
  close(): Promise<void>;
}

const DEDUP_KEY_PREFIX = 'correlation:published';
const DEDUP_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export class RedisCorrelationPublisher implements CorrelationPublisher {
  private redis: Redis;
  private streamKey: string;

  constructor(redis: Redis, streamKey: string = REDIS_STREAMS.CORRELATION_RESULTS) {
    this.redis = redis;
    this.streamKey = streamKey;
  }

  async publish(result: CorrelationResult): Promise<string> {
    const dedupKey = this.getDedupKey(result.stripe_event_id, result.chain_tx_hash);

    const alreadyPublished = await this.isPublished(result.stripe_event_id, result.chain_tx_hash);
    if (alreadyPublished) {
      return '';
    }

    const fields: string[] = [
      'stripe_event_id',
      result.stripe_event_id,
      'chain_tx_hash',
      result.chain_tx_hash,
      'chain',
      result.chain,
      'confidence',
      result.confidence.toString(),
      'amount_match',
      result.match_details.amountMatch.toString(),
      'amount_delta',
      result.match_details.amountDelta.toString(),
      'timing_match',
      result.match_details.timingMatch.toString(),
      'timing_delta_ms',
      result.match_details.timingDeltaMs.toString(),
      'chain_match',
      result.match_details.chainMatch.toString(),
      'token_match',
      result.match_details.tokenMatch.toString(),
      'correlated_at',
      result.correlated_at,
    ];

    const messageId = await this.redis.xadd(this.streamKey, '*', ...fields);
    await this.redis.setex(dedupKey, DEDUP_TTL_SECONDS, '1');

    return messageId ?? '';
  }

  async isPublished(stripeEventId: string, chainTxHash: string): Promise<boolean> {
    const dedupKey = this.getDedupKey(stripeEventId, chainTxHash);
    const exists = await this.redis.exists(dedupKey);
    return exists === 1;
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }

  private getDedupKey(stripeEventId: string, chainTxHash: string): string {
    return `${DEDUP_KEY_PREFIX}:${stripeEventId}:${chainTxHash}`;
  }

  static fromCandidate(candidate: CorrelationCandidate): CorrelationResult {
    return {
      stripe_event_id: candidate.stripeEvent.event_id,
      chain_tx_hash: candidate.chainTransaction.tx_hash,
      chain: candidate.chainTransaction.chain,
      confidence: candidate.confidence,
      match_details: candidate.matchDetails,
      correlated_at: new Date().toISOString(),
    };
  }
}
