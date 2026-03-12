import { REDIS_STREAMS } from '@stripeonchain/shared';

const SERVICE_NAME = 'finality-tracker';

async function main() {
  console.info(`[${SERVICE_NAME}] Starting...`);
  console.info(`[${SERVICE_NAME}] Consuming from: ${REDIS_STREAMS.CORRELATION_RESULTS}`);
  // Service implementation will be added in Milestone 5
  console.info(`[${SERVICE_NAME}] Ready`);
}

main().catch((err) => {
  console.error(`[${SERVICE_NAME}] Fatal error:`, err);
  process.exit(1);
});
