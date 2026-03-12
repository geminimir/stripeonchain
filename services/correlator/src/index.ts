import { REDIS_STREAMS, CORRELATION_DEFAULTS } from '@stripeonchain/shared';

const SERVICE_NAME = 'correlator';

async function main() {
  console.info(`[${SERVICE_NAME}] Starting...`);
  console.info(`[${SERVICE_NAME}] Consuming from: ${REDIS_STREAMS.STRIPE_EVENTS}, ${REDIS_STREAMS.CHAIN_TRANSACTIONS}`);
  console.info(`[${SERVICE_NAME}] Correlation config:`, CORRELATION_DEFAULTS);
  // Service implementation will be added in Milestone 4
  console.info(`[${SERVICE_NAME}] Ready`);
}

main().catch((err) => {
  console.error(`[${SERVICE_NAME}] Fatal error:`, err);
  process.exit(1);
});
