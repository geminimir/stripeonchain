import { REDIS_STREAMS, WEBHOOK_RETRY } from '@stripeonchain/shared';

const SERVICE_NAME = 'webhook-emitter';

async function main() {
  console.info(`[${SERVICE_NAME}] Starting...`);
  console.info(`[${SERVICE_NAME}] Consuming from: ${REDIS_STREAMS.WEBHOOK_EVENTS}`);
  console.info(`[${SERVICE_NAME}] Retry config:`, WEBHOOK_RETRY);
  // Service implementation will be added in Milestone 6
  console.info(`[${SERVICE_NAME}] Ready`);
}

main().catch((err) => {
  console.error(`[${SERVICE_NAME}] Fatal error:`, err);
  process.exit(1);
});
