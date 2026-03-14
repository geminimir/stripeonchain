import { RpcProviderConfig, RpcHealthState, RpcHealthStatus } from '@stripeonchain/shared';
import { RPC_HEALTH_CHECK } from '@stripeonchain/shared';

export interface BlockNumberResponse {
  blockNumber: number;
  timestamp: number;
}

export class RpcProvider {
  readonly config: RpcProviderConfig;
  private healthState: RpcHealthState;

  constructor(config: RpcProviderConfig) {
    this.config = config;
    this.healthState = {
      status: 'unknown',
      lastBlockNumber: null,
      lastBlockTimestamp: null,
      consecutiveFailures: 0,
      lastCheckAt: null,
      lastSuccessAt: null,
    };
  }

  get name(): string {
    return this.config.name;
  }

  get url(): string {
    return this.config.url;
  }

  get priority(): number {
    return this.config.priority;
  }

  get status(): RpcHealthStatus {
    return this.healthState.status;
  }

  get health(): RpcHealthState {
    return { ...this.healthState };
  }

  isHealthy(): boolean {
    return this.healthState.status === 'healthy';
  }

  async checkHealth(): Promise<boolean> {
    const now = Date.now();
    this.healthState.lastCheckAt = now;

    try {
      const response = await this.fetchBlockNumber();

      const isStale = this.isBlockStale(response.timestamp, now);
      if (isStale) {
        this.markUnhealthy('stale_block');
        return false;
      }

      this.markHealthy(response.blockNumber, response.timestamp);
      return true;
    } catch (error) {
      this.incrementFailure();
      return false;
    }
  }

  async fetchBlockNumber(): Promise<BlockNumberResponse> {
    const response = await fetch(this.config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_blockNumber',
        params: [],
      }),
    });

    if (!response.ok) {
      throw new Error(`RPC request failed with status ${response.status}`);
    }

    const data = (await response.json()) as { result?: string; error?: { message: string } };

    if (data.error) {
      throw new Error(`RPC error: ${data.error.message}`);
    }

    if (!data.result) {
      throw new Error('No result in RPC response');
    }

    const blockNumber = parseInt(data.result, 16);
    return { blockNumber, timestamp: Date.now() };
  }

  private isBlockStale(blockTimestamp: number, now: number): boolean {
    if (this.healthState.lastBlockTimestamp === null) {
      return false;
    }

    const timeSinceLastBlock = now - this.healthState.lastBlockTimestamp;
    const blockNotAdvancing =
      this.healthState.lastBlockNumber !== null &&
      this.healthState.lastBlockNumber === this.healthState.lastBlockNumber;

    if (timeSinceLastBlock > RPC_HEALTH_CHECK.STALE_BLOCK_THRESHOLD_MS && blockNotAdvancing) {
      return true;
    }

    return false;
  }

  private markHealthy(blockNumber: number, timestamp: number): void {
    this.healthState.status = 'healthy';
    this.healthState.lastBlockNumber = blockNumber;
    this.healthState.lastBlockTimestamp = timestamp;
    this.healthState.consecutiveFailures = 0;
    this.healthState.lastSuccessAt = Date.now();
  }

  private markUnhealthy(reason: 'consecutive_failures' | 'stale_block'): void {
    this.healthState.status = 'unhealthy';
    console.warn(`[RpcProvider] ${this.config.name} marked unhealthy: ${reason}`, this.healthState);
  }

  private incrementFailure(): void {
    this.healthState.consecutiveFailures++;

    if (this.healthState.consecutiveFailures >= RPC_HEALTH_CHECK.MAX_CONSECUTIVE_FAILURES) {
      this.markUnhealthy('consecutive_failures');
    }
  }

  resetHealth(): void {
    this.healthState = {
      status: 'unknown',
      lastBlockNumber: null,
      lastBlockTimestamp: null,
      consecutiveFailures: 0,
      lastCheckAt: null,
      lastSuccessAt: null,
    };
  }
}
