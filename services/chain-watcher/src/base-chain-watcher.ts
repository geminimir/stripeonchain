import { EventEmitter } from 'events';
import { TransferLog, USDC_CONTRACTS } from '@stripeonchain/shared';
import { ConnectionManager, ConnectionManagerConfig } from './connection-manager';
import { TransactionStore, InsertableTransaction } from './transaction-store';

export interface BaseChainWatcherConfig {
  httpUrl: string;
  wsUrl: string;
  merchantAddresses: string[];
  transactionStore?: TransactionStore;
}

export interface BaseChainWatcherStats {
  transfersDetected: number;
  transfersFiltered: number;
  transfersStored: number;
  duplicatesSkipped: number;
}

export class BaseChainWatcher extends EventEmitter {
  private connectionManager: ConnectionManager;
  private merchantAddresses: Set<string>;
  private transactionStore: TransactionStore | null;
  private stats: BaseChainWatcherStats;
  private isRunning: boolean = false;

  constructor(config: BaseChainWatcherConfig) {
    super();

    this.merchantAddresses = new Set(config.merchantAddresses.map((addr) => addr.toLowerCase()));

    this.transactionStore = config.transactionStore ?? null;

    this.stats = {
      transfersDetected: 0,
      transfersFiltered: 0,
      transfersStored: 0,
      duplicatesSkipped: 0,
    };

    const connectionConfig: ConnectionManagerConfig = {
      httpUrl: config.httpUrl,
      wsUrl: config.wsUrl,
      contractAddress: USDC_CONTRACTS.base,
    };

    this.connectionManager = new ConnectionManager(connectionConfig);
    this.connectionManager.on('transfer', (log: TransferLog) => this.handleTransfer(log));
    this.connectionManager.on('modeChange', (mode: string) => {
      console.info(`[BaseChainWatcher] Connection mode changed to: ${mode}`);
    });
  }

  get merchantAddressCount(): number {
    return this.merchantAddresses.size;
  }

  get statistics(): BaseChainWatcherStats {
    return { ...this.stats };
  }

  get connectionMode(): string {
    return this.connectionManager.mode;
  }

  addMerchantAddress(address: string): void {
    this.merchantAddresses.add(address.toLowerCase());
  }

  removeMerchantAddress(address: string): void {
    this.merchantAddresses.delete(address.toLowerCase());
  }

  hasMerchantAddress(address: string): boolean {
    return this.merchantAddresses.has(address.toLowerCase());
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    console.info(
      `[BaseChainWatcher] Starting with ${this.merchantAddresses.size} merchant address(es)`,
    );
    console.info(`[BaseChainWatcher] Monitoring USDC contract: ${USDC_CONTRACTS.base}`);

    await this.connectionManager.start();
  }

  stop(): void {
    this.isRunning = false;
    this.connectionManager.stop();
    console.info('[BaseChainWatcher] Stopped');
  }

  private async handleTransfer(log: TransferLog): Promise<void> {
    this.stats.transfersDetected++;

    const toAddress = log.to.toLowerCase();

    if (!this.merchantAddresses.has(toAddress)) {
      this.stats.transfersFiltered++;
      return;
    }

    console.info(
      `[BaseChainWatcher] Merchant transfer detected: ${log.transactionHash} ` +
        `(${this.parseAmount(log.value)} USDC to ${log.to})`,
    );

    this.emit('merchantTransfer', log);

    if (this.transactionStore) {
      await this.storeTransaction(log);
    }
  }

  private async storeTransaction(log: TransferLog): Promise<void> {
    if (!this.transactionStore) return;

    const exists = await this.transactionStore.transactionExists('base', log.transactionHash);
    if (exists) {
      this.stats.duplicatesSkipped++;
      console.info(`[BaseChainWatcher] Duplicate transaction skipped: ${log.transactionHash}`);
      return;
    }

    const tx: InsertableTransaction = {
      chain: 'base',
      tx_hash: log.transactionHash,
      block_number: log.blockNumber,
      block_hash: log.blockHash,
      sender_address: log.from.toLowerCase(),
      receiver_address: log.to.toLowerCase(),
      token_contract: USDC_CONTRACTS.base.toLowerCase(),
      token_amount: this.parseRawAmount(log.value),
    };

    try {
      await this.transactionStore.insertTransaction(tx);
      this.stats.transfersStored++;
      console.info(`[BaseChainWatcher] Transaction stored: ${log.transactionHash}`);
      this.emit('transactionStored', tx);
    } catch (error) {
      console.error(`[BaseChainWatcher] Failed to store transaction:`, error);
      this.emit('storeError', { log, error });
    }
  }

  private parseRawAmount(hexValue: string): string {
    const value = BigInt(hexValue);
    return value.toString();
  }

  private parseAmount(hexValue: string): string {
    const value = BigInt(hexValue);
    const decimals = 6;
    const divisor = BigInt(10 ** decimals);
    const integerPart = value / divisor;
    const fractionalPart = value % divisor;
    const paddedFractional = fractionalPart.toString().padStart(decimals, '0');
    return `${integerPart}.${paddedFractional}`;
  }
}
