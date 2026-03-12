import { REDIS_STREAMS } from '@stripeonchain/shared';

const SERVICE_NAME = 'stripe-listener';

async function main() {
  console.info(`[${SERVICE_NAME}] Starting... (publishing to ${REDIS_STREAMS.STRIPE_EVENTS})`);
  console.info(`[${SERVICE_NAME}] Ready`);
}

main().catch((err) => {
  console.error(`[${SERVICE_NAME}] Fatal error:`, err);
  process.exit(1);
});
