import Redis from 'ioredis';
import {
  REDIS_STREAMS,
  StripeEventMessage,
  ChainTransactionMessage,
  SupportedChain,
} from '@stripeonchain/shared';
import { EventEmitter } from 'events';

export interface StreamConsumerConfig {
  groupName: string;
  consumerName: string;
  blockMs?: number;
  batchSize?: number;
}

export class StreamConsumer extends EventEmitter {
  private redis: Redis;
  private config: StreamConsumerConfig;
  private isRunning: boolean = false;

  constructor(redis: Redis, config: StreamConsumerConfig) {
    super();
    this.redis = redis;
    this.config = {
      ...config,
      blockMs: config.blockMs ?? 5000,
      batchSize: config.batchSize ?? 10,
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    await this.ensureConsumerGroups();

    this.isRunning = true;
    console.info('[StreamConsumer] Starting consumption loop');

    this.consumeLoop();
  }

  stop(): void {
    this.isRunning = false;
    console.info('[StreamConsumer] Stopped');
  }

  private async ensureConsumerGroups(): Promise<void> {
    const streams = [REDIS_STREAMS.STRIPE_EVENTS, REDIS_STREAMS.CHAIN_TRANSACTIONS];

    for (const stream of streams) {
      try {
        await this.redis.xgroup('CREATE', stream, this.config.groupName, '0', 'MKSTREAM');
        console.info(`[StreamConsumer] Created consumer group for ${stream}`);
      } catch (error) {
        const err = error as Error;
        if (!err.message.includes('BUSYGROUP')) {
          throw error;
        }
      }
    }
  }

  private async consumeLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        const results = await this.redis.xreadgroup(
          'GROUP',
          this.config.groupName,
          this.config.consumerName,
          'COUNT',
          this.config.batchSize!,
          'BLOCK',
          this.config.blockMs!,
          'STREAMS',
          REDIS_STREAMS.STRIPE_EVENTS,
          REDIS_STREAMS.CHAIN_TRANSACTIONS,
          '>',
          '>',
        );

        if (results) {
          await this.processResults(results as StreamReadResult);
        }
      } catch (error) {
        console.error('[StreamConsumer] Error in consume loop:', error);
        await this.sleep(1000);
      }
    }
  }

  private async processResults(results: StreamReadResult): Promise<void> {
    for (const [stream, messages] of results) {
      for (const [messageId, fields] of messages) {
        const data = this.parseFields(fields);

        if (stream === REDIS_STREAMS.STRIPE_EVENTS) {
          const event = this.parseStripeEvent(data);
          this.emit('stripeEvent', event, messageId);
        } else if (stream === REDIS_STREAMS.CHAIN_TRANSACTIONS) {
          const tx = this.parseChainTransaction(data);
          this.emit('chainTransaction', tx, messageId);
        }
      }
    }
  }

  private parseFields(fields: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      result[fields[i]] = fields[i + 1];
    }
    return result;
  }

  private parseStripeEvent(data: Record<string, string>): StripeEventMessage {
    return {
      event_id: data.event_id,
      payment_intent_id: data.payment_intent_id,
      amount: data.amount,
      chain: (data.chain as SupportedChain) || null,
      token: data.token || null,
      timestamp: data.timestamp,
    };
  }

  private parseChainTransaction(data: Record<string, string>): ChainTransactionMessage {
    return {
      chain: data.chain as SupportedChain,
      tx_hash: data.tx_hash,
      block_number: parseInt(data.block_number, 10),
      block_hash: data.block_hash,
      amount: data.amount,
      sender: data.sender,
      receiver: data.receiver,
      token_contract: data.token_contract,
      detected_at: data.detected_at,
    };
  }

  async acknowledge(stream: string, messageId: string): Promise<void> {
    await this.redis.xack(stream, this.config.groupName, messageId);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

type StreamReadResult = Array<[string, Array<[string, string[]]>]>;
