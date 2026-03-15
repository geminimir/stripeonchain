import { REDIS_STREAMS, USDC_CONTRACTS } from '@stripeonchain/shared';
import { BaseChainWatcher } from './base-chain-watcher';
import { PostgresTransactionStore } from './transaction-store';

const SERVICE_NAME = 'chain-watcher';

function getMerchantAddresses(): string[] {
  const addresses = process.env.MERCHANT_ADDRESSES;
  if (!addresses) {
    return [];
  }
  return addresses
    .split(',')
    .map((addr) => addr.trim())
    .filter((addr) => addr.length > 0);
}

async function main() {
  console.info(`[${SERVICE_NAME}] Starting... (publishing to ${REDIS_STREAMS.CHAIN_TRANSACTIONS})`);
  console.info(`[${SERVICE_NAME}] Monitoring USDC contracts:`, USDC_CONTRACTS);

  const httpUrl = process.env.BASE_RPC_URL;
  const wsUrl = process.env.BASE_RPC_WS_URL;
  const databaseUrl = process.env.DATABASE_URL;

  if (!httpUrl || !wsUrl) {
    throw new Error('BASE_RPC_URL and BASE_RPC_WS_URL must be configured');
  }

  const merchantAddresses = getMerchantAddresses();
  console.info(`[${SERVICE_NAME}] Configured ${merchantAddresses.length} merchant address(es)`);

  let transactionStore: PostgresTransactionStore | undefined;
  if (databaseUrl) {
    transactionStore = new PostgresTransactionStore(databaseUrl);
    console.info(`[${SERVICE_NAME}] Database connection configured`);
  } else {
    console.warn(
      `[${SERVICE_NAME}] No DATABASE_URL configured, transactions will not be persisted`,
    );
  }

  const watcher = new BaseChainWatcher({
    httpUrl,
    wsUrl,
    merchantAddresses,
    transactionStore,
  });

  watcher.on('merchantTransfer', (log) => {
    console.info(`[${SERVICE_NAME}] Merchant transfer: ${log.transactionHash}`);
  });

  watcher.on('transactionStored', (tx) => {
    console.info(`[${SERVICE_NAME}] Transaction stored: ${tx.tx_hash}`);
  });

  await watcher.start();

  const shutdown = async () => {
    console.info(`[${SERVICE_NAME}] Shutting down...`);
    watcher.stop();
    if (transactionStore) {
      await transactionStore.close();
    }
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
