import { ConnectionManager, ConnectionManagerConfig } from '../connection-manager';

const mockFetch = jest.fn();
global.fetch = mockFetch;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: Error) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  private url: string;
  private openTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string) {
    this.url = url;
    this.openTimer = setTimeout(() => {
      if (this.readyState === MockWebSocket.CONNECTING) {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.();
      }
    }, 0);
  }

  send = jest.fn();

  close() {
    if (this.openTimer) {
      clearTimeout(this.openTimer);
    }
    this.readyState = MockWebSocket.CLOSED;
  }

  simulateMessage(data: string) {
    this.onmessage?.({ data });
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  simulateError(error: Error) {
    this.onerror?.(error);
  }
}

(global as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;

describe('ConnectionManager', () => {
  const defaultConfig: ConnectionManagerConfig = {
    httpUrl: 'https://base-mainnet.example.com',
    wsUrl: 'wss://base-mainnet.example.com',
    contractAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    pollingIntervalMs: 100,
  };

  let manager: ConnectionManager;
  let mockWsInstance: MockWebSocket | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockWsInstance = null;

    const WebSocketFactory = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        mockWsInstance = this;
      }
    };
    (global as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = WebSocketFactory;
  });

  afterEach(() => {
    if (manager) {
      manager.stop();
    }
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with disconnected mode', () => {
      manager = new ConnectionManager(defaultConfig);

      expect(manager.mode).toBe('disconnected');
      expect(manager.connectionState.lastBlockNumber).toBeNull();
    });
  });

  describe('start', () => {
    it('should fetch current block number and connect WebSocket', async () => {
      manager = new ConnectionManager(defaultConfig);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
      });

      const startPromise = manager.start();
      await jest.advanceTimersByTimeAsync(0);
      await startPromise;

      expect(mockFetch).toHaveBeenCalledWith(
        defaultConfig.httpUrl,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('eth_blockNumber'),
        }),
      );

      expect(manager.connectionState.lastBlockNumber).toBe(0x100);
    });

    it('should transition to websocket mode on successful connection', async () => {
      manager = new ConnectionManager(defaultConfig);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
      });

      const modeChanges: string[] = [];
      manager.on('modeChange', (mode) => modeChanges.push(mode));

      const startPromise = manager.start();
      await jest.advanceTimersByTimeAsync(0);
      await startPromise;

      expect(manager.mode).toBe('websocket');
      expect(modeChanges).toContain('websocket');
    });
  });

  describe('WebSocket disconnect handling', () => {
    it('should switch to polling mode when WebSocket disconnects', async () => {
      manager = new ConnectionManager(defaultConfig);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
      });

      const modeChanges: string[] = [];
      manager.on('modeChange', (mode) => modeChanges.push(mode));

      const startPromise = manager.start();
      await jest.advanceTimersByTimeAsync(0);
      await startPromise;

      expect(manager.mode).toBe('websocket');

      mockWsInstance?.simulateClose();

      expect(manager.mode).toBe('polling');
      expect(modeChanges).toContain('polling');
    });

    it('should schedule WebSocket reconnection after disconnect', async () => {
      manager = new ConnectionManager(defaultConfig);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
      });

      const startPromise = manager.start();
      await jest.advanceTimersByTimeAsync(0);
      await startPromise;

      mockWsInstance?.simulateClose();

      expect(manager.connectionState.reconnectAttempts).toBe(1);
    });

    it('should use exponential backoff for reconnection attempts', async () => {
      manager = new ConnectionManager(defaultConfig);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
      });

      const startPromise = manager.start();
      await jest.advanceTimersByTimeAsync(0);
      await startPromise;

      mockWsInstance?.simulateClose();
      expect(manager.connectionState.reconnectAttempts).toBe(1);

      await jest.advanceTimersByTimeAsync(5000);
      mockWsInstance?.simulateClose();
      expect(manager.connectionState.reconnectAttempts).toBe(2);

      await jest.advanceTimersByTimeAsync(10000);
      mockWsInstance?.simulateClose();
      expect(manager.connectionState.reconnectAttempts).toBe(3);
    });
  });

  describe('polling mode', () => {
    it('should poll for logs at configured interval', async () => {
      manager = new ConnectionManager(defaultConfig);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
        })
        .mockResolvedValue({
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x105', result2: [] }),
        });

      const startPromise = manager.start();
      await jest.advanceTimersByTimeAsync(0);
      await startPromise;

      mockWsInstance?.simulateClose();

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x105' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: [] }),
        });

      await jest.advanceTimersByTimeAsync(100);

      const pollCalls = mockFetch.mock.calls.filter((call) =>
        call[1]?.body?.includes('eth_getLogs'),
      );

      expect(pollCalls.length).toBeGreaterThan(0);
    });

    it('should emit transfer events from polled logs', async () => {
      manager = new ConnectionManager(defaultConfig);

      const transferEvents: unknown[] = [];
      manager.on('transfer', (log) => transferEvents.push(log));

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x105' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            jsonrpc: '2.0',
            id: 1,
            result: [
              {
                transactionHash: '0xabc123',
                blockNumber: '0x101',
                blockHash: '0xblock123',
                logIndex: '0x0',
                topics: [
                  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                  '0x000000000000000000000000sender0000000000000000000000000000000000',
                  '0x000000000000000000000000receiver00000000000000000000000000000000',
                ],
                data: '0x0000000000000000000000000000000000000000000000000000000000000064',
              },
            ],
          }),
        });

      const startPromise = manager.start();
      await jest.advanceTimersByTimeAsync(0);
      await startPromise;

      mockWsInstance?.simulateClose();

      await jest.runAllTimersAsync();

      expect(transferEvents.length).toBe(1);
      expect(transferEvents[0]).toMatchObject({
        transactionHash: '0xabc123',
        blockNumber: 0x101,
      });
    });

    it('should track block range correctly during polling', async () => {
      manager = new ConnectionManager(defaultConfig);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x110' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: [] }),
        });

      const startPromise = manager.start();
      await jest.advanceTimersByTimeAsync(0);
      await startPromise;

      expect(manager.connectionState.lastBlockNumber).toBe(0x100);

      mockWsInstance?.simulateClose();

      await jest.runAllTimersAsync();

      expect(manager.connectionState.lastBlockNumber).toBe(0x110);
    });
  });

  describe('WebSocket reconnection', () => {
    it('should resume WebSocket mode after successful reconnection', async () => {
      manager = new ConnectionManager(defaultConfig);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
      });

      const modeChanges: string[] = [];
      manager.on('modeChange', (mode) => modeChanges.push(mode));

      const startPromise = manager.start();
      await jest.advanceTimersByTimeAsync(0);
      await startPromise;

      expect(manager.mode).toBe('websocket');

      mockWsInstance?.simulateClose();
      expect(manager.mode).toBe('polling');

      // Advance past reconnect delay
      await jest.advanceTimersByTimeAsync(5000);
      // Allow WebSocket constructor setTimeout to fire
      await jest.advanceTimersByTimeAsync(1);

      expect(manager.mode).toBe('websocket');
      expect(modeChanges).toEqual(['websocket', 'polling', 'websocket']);
    });

    it('should stop polling when WebSocket reconnects', async () => {
      manager = new ConnectionManager(defaultConfig);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
      });

      const startPromise = manager.start();
      await jest.advanceTimersByTimeAsync(0);
      await startPromise;

      mockWsInstance?.simulateClose();
      expect(manager.mode).toBe('polling');

      // Advance past reconnect delay and allow WS constructor to fire
      await jest.advanceTimersByTimeAsync(5000);
      await jest.advanceTimersByTimeAsync(1);
      expect(manager.mode).toBe('websocket');

      mockFetch.mockClear();

      await jest.advanceTimersByTimeAsync(200);

      const pollCalls = mockFetch.mock.calls.filter((call) =>
        call[1]?.body?.includes('eth_getLogs'),
      );
      expect(pollCalls.length).toBe(0);
    });

    it('should reset reconnect attempts on successful connection', async () => {
      manager = new ConnectionManager(defaultConfig);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
      });

      const startPromise = manager.start();
      await jest.advanceTimersByTimeAsync(0);
      await startPromise;

      mockWsInstance?.simulateClose();
      expect(manager.connectionState.reconnectAttempts).toBe(1);

      // Advance past reconnect delay and allow WS constructor to fire
      await jest.advanceTimersByTimeAsync(5000);
      await jest.advanceTimersByTimeAsync(1);

      expect(manager.connectionState.reconnectAttempts).toBe(0);
    });
  });

  describe('WebSocket message handling', () => {
    it('should emit transfer events from WebSocket subscription', async () => {
      manager = new ConnectionManager(defaultConfig);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
      });

      const transferEvents: unknown[] = [];
      manager.on('transfer', (log) => transferEvents.push(log));

      const startPromise = manager.start();
      await jest.advanceTimersByTimeAsync(0);
      await startPromise;

      const message = JSON.stringify({
        method: 'eth_subscription',
        params: {
          result: {
            transactionHash: '0xdef456',
            blockNumber: '0x102',
            blockHash: '0xblock456',
            logIndex: '0x1',
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x000000000000000000000000sender0000000000000000000000000000000000',
              '0x000000000000000000000000receiver00000000000000000000000000000000',
            ],
            data: '0x00000000000000000000000000000000000000000000000000000000000003e8',
          },
        },
      });

      mockWsInstance?.simulateMessage(message);

      expect(transferEvents.length).toBe(1);
      expect(transferEvents[0]).toMatchObject({
        transactionHash: '0xdef456',
        blockNumber: 0x102,
      });
    });

    it('should subscribe to Transfer events on WebSocket connect', async () => {
      manager = new ConnectionManager(defaultConfig);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
      });

      const startPromise = manager.start();
      await jest.advanceTimersByTimeAsync(0);
      await startPromise;

      expect(mockWsInstance?.send).toHaveBeenCalledWith(expect.stringContaining('eth_subscribe'));
      expect(mockWsInstance?.send).toHaveBeenCalledWith(
        expect.stringContaining(
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
        ),
      );
    });
  });

  describe('stop', () => {
    it('should clean up all resources on stop', async () => {
      manager = new ConnectionManager(defaultConfig);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
      });

      const startPromise = manager.start();
      await jest.advanceTimersByTimeAsync(0);
      await startPromise;

      manager.stop();

      expect(manager.mode).toBe('disconnected');
    });

    it('should not restart after stop', async () => {
      manager = new ConnectionManager(defaultConfig);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x100' }),
      });

      const startPromise = manager.start();
      await jest.advanceTimersByTimeAsync(0);
      await startPromise;

      mockWsInstance?.simulateClose();
      manager.stop();

      await jest.advanceTimersByTimeAsync(60000);

      expect(manager.mode).toBe('disconnected');
    });
  });
});
