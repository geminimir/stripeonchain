import Redis from 'ioredis';
import {
  REDIS_STREAMS,
  CORRELATION_DEFAULTS,
  StripeEventMessage,
  ChainTransactionMessage,
} from '@stripeonchain/shared';
import { StreamConsumer } from './stream-consumer';
import { CorrelationEngine } from './correlation-engine';
import { RedisCorrelationPublisher } from './correlation-publisher';

const SERVICE_NAME = 'correlator';

async function main() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const redis = new Redis(redisUrl);

  console.info(`[${SERVICE_NAME}] Starting...`);
  console.info(
    `[${SERVICE_NAME}] Consuming from: ${REDIS_STREAMS.STRIPE_EVENTS}, ${REDIS_STREAMS.CHAIN_TRANSACTIONS}`,
  );
  console.info(`[${SERVICE_NAME}] Correlation config:`, CORRELATION_DEFAULTS);

  const consumer = new StreamConsumer(redis, {
    groupName: 'correlator-group',
    consumerName: `correlator-${process.pid}`,
  });

  const engine = new CorrelationEngine();
  const publisher = new RedisCorrelationPublisher(redis);

  consumer.on('stripeEvent', async (event: StripeEventMessage, messageId: string) => {
    console.info(`[${SERVICE_NAME}] Received Stripe event: ${event.event_id}`);

    const match = engine.addStripeEvent(event);
    if (match) {
      const result = RedisCorrelationPublisher.fromCandidate(match);
      await publisher.publish(result);
      console.info(
        `[${SERVICE_NAME}] Matched: ${event.event_id} -> ${match.chainTransaction.tx_hash} (confidence: ${match.confidence.toFixed(2)})`,
      );
    }

    await consumer.acknowledge(REDIS_STREAMS.STRIPE_EVENTS, messageId);
  });

  consumer.on('chainTransaction', async (tx: ChainTransactionMessage, messageId: string) => {
    console.info(`[${SERVICE_NAME}] Received chain transaction: ${tx.tx_hash}`);

    const match = engine.addChainTransaction(tx);
    if (match) {
      const result = RedisCorrelationPublisher.fromCandidate(match);
      await publisher.publish(result);
      console.info(
        `[${SERVICE_NAME}] Matched: ${match.stripeEvent.event_id} -> ${tx.tx_hash} (confidence: ${match.confidence.toFixed(2)})`,
      );
    }

    await consumer.acknowledge(REDIS_STREAMS.CHAIN_TRANSACTIONS, messageId);
  });

  await consumer.start();

  const shutdown = async () => {
    console.info(`[${SERVICE_NAME}] Shutting down...`);
    consumer.stop();
    await publisher.close();
    await redis.quit();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.info(`[${SERVICE_NAME}] Ready`);
}

main().catch((err) => {
  console.error(`[${SERVICE_NAME}] Fatal error:`, err);
  process.exit(1);
});
