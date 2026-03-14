import { RpcHealthManager } from '../rpc-health-manager';
import { RpcProviderConfig } from '@stripeonchain/shared';

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('RpcHealthManager', () => {
  const primaryConfig: RpcProviderConfig = {
    url: 'https://primary.example.com',
    name: 'primary',
    priority: 1,
  };

  const secondaryConfig: RpcProviderConfig = {
    url: 'https://secondary.example.com',
    name: 'secondary',
    priority: 2,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should throw if no providers are configured', () => {
      expect(() => new RpcHealthManager([])).toThrow(
        'At least one RPC provider config is required',
      );
    });

    it('should sort providers by priority', () => {
      const manager = new RpcHealthManager([secondaryConfig, primaryConfig]);

      expect(manager.activeProviderName).toBe('primary');
    });

    it('should set first provider as active', () => {
      const manager = new RpcHealthManager([primaryConfig, secondaryConfig]);

      expect(manager.activeProviderName).toBe('primary');
      expect(manager.activeProviderUrl).toBe('https://primary.example.com');
    });
  });

  describe('health checks', () => {
    it('should mark provider healthy after successful check', async () => {
      const manager = new RpcHealthManager([primaryConfig]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
      });

      await manager.runHealthChecks();

      const metrics = manager.getMetrics();
      expect(metrics.providers[0].status).toBe('healthy');
    });

    it('should check all providers during health check', async () => {
      const manager = new RpcHealthManager([primaryConfig, secondaryConfig]);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x101' }),
        });

      await manager.runHealthChecks();

      const metrics = manager.getMetrics();
      expect(metrics.providers[0].status).toBe('healthy');
      expect(metrics.providers[1].status).toBe('healthy');
    });
  });

  describe('failover', () => {
    it('should failover to secondary when primary becomes unhealthy', async () => {
      const manager = new RpcHealthManager([primaryConfig, secondaryConfig]);

      for (let i = 0; i < 3; i++) {
        mockFetch.mockRejectedValueOnce(new Error('Primary down')).mockResolvedValueOnce({
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
        });

        await manager.runHealthChecks();
      }

      expect(manager.activeProviderName).toBe('secondary');
    });

    it('should stay with current provider if healthy', async () => {
      const manager = new RpcHealthManager([primaryConfig, secondaryConfig]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
      });

      await manager.runHealthChecks();
      await manager.runHealthChecks();
      await manager.runHealthChecks();

      expect(manager.activeProviderName).toBe('primary');
    });

    it('should failover when getBlockNumber fails', async () => {
      const manager = new RpcHealthManager([primaryConfig, secondaryConfig]);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
        });
      await manager.runHealthChecks();

      mockFetch.mockRejectedValueOnce(new Error('Primary failed')).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x101' }),
      });

      const blockNumber = await manager.getBlockNumber();

      expect(blockNumber).toBe(0x101);
      expect(manager.activeProviderName).toBe('secondary');
    });
  });

  describe('getMetrics', () => {
    it('should return metrics for all providers', async () => {
      const manager = new RpcHealthManager([primaryConfig, secondaryConfig]);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
        })
        .mockRejectedValueOnce(new Error('Secondary down'));

      await manager.runHealthChecks();

      const metrics = manager.getMetrics();

      expect(metrics.activeProvider).toBe('primary');
      expect(metrics.providers).toHaveLength(2);
      expect(metrics.providers[0].name).toBe('primary');
      expect(metrics.providers[0].status).toBe('healthy');
      expect(metrics.providers[0].lastBlockNumber).toBe(0x100);
      expect(metrics.providers[1].name).toBe('secondary');
      expect(metrics.providers[1].consecutiveFailures).toBe(1);
    });
  });

  describe('start/stop', () => {
    it('should start and stop health check loop', async () => {
      const manager = new RpcHealthManager([primaryConfig]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
      });

      await manager.start();

      expect(mockFetch).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(10000);
      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalledTimes(2);

      manager.stop();

      jest.advanceTimersByTime(10000);
      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should not start twice', async () => {
      const manager = new RpcHealthManager([primaryConfig]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
      });

      await manager.start();
      await manager.start();

      expect(mockFetch).toHaveBeenCalledTimes(1);

      manager.stop();
    });
  });

  describe('getBlockNumber', () => {
    it('should return block number from active provider', async () => {
      const manager = new RpcHealthManager([primaryConfig]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0xabc' }),
      });

      const blockNumber = await manager.getBlockNumber();

      expect(blockNumber).toBe(0xabc);
    });

    it('should throw when all providers fail', async () => {
      const manager = new RpcHealthManager([primaryConfig]);

      mockFetch.mockRejectedValue(new Error('All providers down'));

      await expect(manager.getBlockNumber()).rejects.toThrow();
    });
  });
});
