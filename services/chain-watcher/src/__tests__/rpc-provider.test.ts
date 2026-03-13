import { RpcProvider } from '../rpc-provider';
import { RpcProviderConfig } from '@stripeonchain/shared';

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('RpcProvider', () => {
  const defaultConfig: RpcProviderConfig = {
    url: 'https://eth-mainnet.example.com',
    name: 'primary',
    priority: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with unknown health status', () => {
      const provider = new RpcProvider(defaultConfig);

      expect(provider.name).toBe('primary');
      expect(provider.url).toBe('https://eth-mainnet.example.com');
      expect(provider.priority).toBe(1);
      expect(provider.status).toBe('unknown');
      expect(provider.isHealthy()).toBe(false);
    });
  });

  describe('checkHealth', () => {
    it('should mark provider as healthy on successful eth_blockNumber call', async () => {
      const provider = new RpcProvider(defaultConfig);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x1234567' }),
      });

      const result = await provider.checkHealth();

      expect(result).toBe(true);
      expect(provider.status).toBe('healthy');
      expect(provider.isHealthy()).toBe(true);
      expect(provider.health.lastBlockNumber).toBe(0x1234567);
      expect(provider.health.consecutiveFailures).toBe(0);
    });

    it('should increment consecutive failures on RPC error', async () => {
      const provider = new RpcProvider(defaultConfig);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, error: { message: 'Rate limited' } }),
      });

      const result = await provider.checkHealth();

      expect(result).toBe(false);
      expect(provider.health.consecutiveFailures).toBe(1);
    });

    it('should increment consecutive failures on network error', async () => {
      const provider = new RpcProvider(defaultConfig);

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.checkHealth();

      expect(result).toBe(false);
      expect(provider.health.consecutiveFailures).toBe(1);
    });

    it('should mark provider unhealthy after 3 consecutive failures', async () => {
      const provider = new RpcProvider(defaultConfig);

      mockFetch.mockRejectedValue(new Error('Network error'));

      await provider.checkHealth();
      expect(provider.status).toBe('unknown');

      await provider.checkHealth();
      expect(provider.status).toBe('unknown');

      await provider.checkHealth();
      expect(provider.status).toBe('unhealthy');
      expect(provider.health.consecutiveFailures).toBe(3);
    });

    it('should reset consecutive failures on success', async () => {
      const provider = new RpcProvider(defaultConfig);

      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      await provider.checkHealth();
      expect(provider.health.consecutiveFailures).toBe(1);

      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      await provider.checkHealth();
      expect(provider.health.consecutiveFailures).toBe(2);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
      });
      await provider.checkHealth();

      expect(provider.health.consecutiveFailures).toBe(0);
      expect(provider.status).toBe('healthy');
    });
  });

  describe('fetchBlockNumber', () => {
    it('should return block number on success', async () => {
      const provider = new RpcProvider(defaultConfig);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0xabc' }),
      });

      const response = await provider.fetchBlockNumber();

      expect(response.blockNumber).toBe(0xabc);
      expect(response.timestamp).toBeGreaterThan(0);
    });

    it('should throw on HTTP error', async () => {
      const provider = new RpcProvider(defaultConfig);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(provider.fetchBlockNumber()).rejects.toThrow(
        'RPC request failed with status 500',
      );
    });

    it('should throw on RPC error response', async () => {
      const provider = new RpcProvider(defaultConfig);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          error: { message: 'Method not found' },
        }),
      });

      await expect(provider.fetchBlockNumber()).rejects.toThrow('RPC error: Method not found');
    });
  });

  describe('resetHealth', () => {
    it('should reset health state to initial values', async () => {
      const provider = new RpcProvider(defaultConfig);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
      });
      await provider.checkHealth();

      expect(provider.status).toBe('healthy');

      provider.resetHealth();

      expect(provider.status).toBe('unknown');
      expect(provider.health.lastBlockNumber).toBeNull();
      expect(provider.health.consecutiveFailures).toBe(0);
    });
  });
});
