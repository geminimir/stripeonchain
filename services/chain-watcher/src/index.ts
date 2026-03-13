import { REDIS_STREAMS, USDC_CONTRACTS, RpcProviderConfig } from '@stripeonchain/shared';
import { RpcHealthManager } from './rpc-health-manager';

const SERVICE_NAME = 'chain-watcher';

function getRpcConfigs(): RpcProviderConfig[] {
  const primary = process.env.RPC_URL_PRIMARY;
  const secondary = process.env.RPC_URL_SECONDARY;

  const configs: RpcProviderConfig[] = [];

  if (primary) {
    configs.push({
      url: primary,
      name: 'primary',
      priority: 1,
    });
  }

  if (secondary) {
    configs.push({
      url: secondary,
      name: 'secondary',
      priority: 2,
    });
  }

  if (configs.length === 0) {
    throw new Error('At least RPC_URL_PRIMARY must be configured');
  }

  return configs;
}

async function main() {
  console.info(`[${SERVICE_NAME}] Starting... (publishing to ${REDIS_STREAMS.CHAIN_TRANSACTIONS})`);
  console.info(`[${SERVICE_NAME}] Monitoring USDC contracts:`, USDC_CONTRACTS);

  const rpcConfigs = getRpcConfigs();
  const healthManager = new RpcHealthManager(rpcConfigs);

  console.info(`[${SERVICE_NAME}] Configured ${rpcConfigs.length} RPC provider(s)`);

  await healthManager.start();

  const shutdown = () => {
    console.info(`[${SERVICE_NAME}] Shutting down...`);
    healthManager.stop();
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
