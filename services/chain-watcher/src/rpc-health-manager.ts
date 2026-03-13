import { RpcProviderConfig, RpcHealthStatus } from '@stripeonchain/shared';
import { RPC_HEALTH_CHECK } from '@stripeonchain/shared';
import { RpcProvider } from './rpc-provider';

export interface RpcHealthMetrics {
  activeProvider: string | null;
  providers: Array<{
    name: string;
    status: RpcHealthStatus;
    consecutiveFailures: number;
    lastBlockNumber: number | null;
    lastCheckAt: number | null;
  }>;
}

export class RpcHealthManager {
  private providers: RpcProvider[];
  private activeProviderIndex: number = 0;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;

  constructor(configs: RpcProviderConfig[]) {
    if (configs.length === 0) {
      throw new Error('At least one RPC provider config is required');
    }

    this.providers = configs
      .sort((a, b) => a.priority - b.priority)
      .map((config) => new RpcProvider(config));
  }

  get activeProvider(): RpcProvider | null {
    return this.providers[this.activeProviderIndex] ?? null;
  }

  get activeProviderName(): string | null {
    return this.activeProvider?.name ?? null;
  }

  get activeProviderUrl(): string | null {
    return this.activeProvider?.url ?? null;
  }

  getMetrics(): RpcHealthMetrics {
    return {
      activeProvider: this.activeProviderName,
      providers: this.providers.map((p) => ({
        name: p.name,
        status: p.status,
        consecutiveFailures: p.health.consecutiveFailures,
        lastBlockNumber: p.health.lastBlockNumber,
        lastCheckAt: p.health.lastCheckAt,
      })),
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    console.info('[RpcHealthManager] Starting health check loop');

    await this.runHealthChecks();

    this.healthCheckInterval = setInterval(async () => {
      await this.runHealthChecks();
    }, RPC_HEALTH_CHECK.INTERVAL_MS);
  }

  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    this.isRunning = false;
    console.info('[RpcHealthManager] Stopped health check loop');
  }

  async runHealthChecks(): Promise<void> {
    const results = await Promise.all(
      this.providers.map(async (provider) => {
        const isHealthy = await provider.checkHealth();
        return { provider, isHealthy };
      }),
    );

    const currentProvider = this.activeProvider;
    if (currentProvider && !currentProvider.isHealthy()) {
      await this.failover();
    }

    this.logHealthStatus(results);
  }

  private async failover(): Promise<boolean> {
    const currentName = this.activeProviderName;

    for (let i = 0; i < this.providers.length; i++) {
      if (i === this.activeProviderIndex) continue;

      const candidate = this.providers[i];
      if (candidate.isHealthy()) {
        this.activeProviderIndex = i;
        console.info(`[RpcHealthManager] Failover: ${currentName} -> ${candidate.name}`);
        return true;
      }
    }

    console.warn('[RpcHealthManager] No healthy providers available for failover');
    return false;
  }

  private logHealthStatus(results: Array<{ provider: RpcProvider; isHealthy: boolean }>): void {
    const healthyCount = results.filter((r) => r.isHealthy).length;
    const totalCount = results.length;

    console.info(
      `[RpcHealthManager] Health check complete: ${healthyCount}/${totalCount} healthy, active: ${this.activeProviderName}`,
    );
  }

  async getBlockNumber(): Promise<number> {
    const provider = this.activeProvider;
    if (!provider) {
      throw new Error('No active RPC provider');
    }

    try {
      const response = await provider.fetchBlockNumber();
      return response.blockNumber;
    } catch (error) {
      console.error(`[RpcHealthManager] Failed to get block number from ${provider.name}:`, error);

      const didFailover = await this.failover();
      if (didFailover && this.activeProvider) {
        const response = await this.activeProvider.fetchBlockNumber();
        return response.blockNumber;
      }

      throw error;
    }
  }
}
