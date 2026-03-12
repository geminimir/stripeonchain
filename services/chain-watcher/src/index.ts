import { REDIS_STREAMS, USDC_CONTRACTS } from '@stripeonchain/shared';

const SERVICE_NAME = 'chain-watcher';

async function main() {
  console.info(`[${SERVICE_NAME}] Starting... (publishing to ${REDIS_STREAMS.CHAIN_TRANSACTIONS})`);
  console.info(`[${SERVICE_NAME}] Monitoring USDC contracts:`, USDC_CONTRACTS);
  console.info(`[${SERVICE_NAME}] Ready`);
}

main().catch((err) => {
  console.error(`[${SERVICE_NAME}] Fatal error:`, err);
  process.exit(1);
});
