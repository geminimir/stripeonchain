import { ConnectionMode, TransferLog } from '@stripeonchain/shared';
import { CHAIN_WATCHER } from '@stripeonchain/shared';
import { EventEmitter } from 'events';

export interface ConnectionManagerConfig {
  httpUrl: string;
  wsUrl: string;
  contractAddress: string;
  pollingIntervalMs?: number;
}

export interface ConnectionState {
  mode: ConnectionMode;
  lastBlockNumber: number | null;
  wsConnectedAt: number | null;
  wsDisconnectedAt: number | null;
  reconnectAttempts: number;
}

const TRANSFER_EVENT_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export class ConnectionManager extends EventEmitter {
  private config: ConnectionManagerConfig;
  private state: ConnectionState;
  private ws: WebSocket | null = null;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private isRunning: boolean = false;

  constructor(config: ConnectionManagerConfig) {
    super();
    this.config = {
      ...config,
      pollingIntervalMs: config.pollingIntervalMs ?? CHAIN_WATCHER.POLLING_INTERVAL_MS,
    };
    this.state = {
      mode: 'disconnected',
      lastBlockNumber: null,
      wsConnectedAt: null,
      wsDisconnectedAt: null,
      reconnectAttempts: 0,
    };
  }

  get mode(): ConnectionMode {
    return this.state.mode;
  }

  get connectionState(): ConnectionState {
    return { ...this.state };
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    console.info('[ConnectionManager] Starting...');

    const blockNumber = await this.fetchCurrentBlockNumber();
    this.state.lastBlockNumber = blockNumber;

    await this.connectWebSocket();
  }

  stop(): void {
    this.isRunning = false;
    this.disconnectWebSocket();
    this.stopPolling();
    this.clearReconnectTimeout();
    this.state.mode = 'disconnected';
    console.info('[ConnectionManager] Stopped');
  }

  private async connectWebSocket(): Promise<void> {
    if (!this.isRunning) return;

    try {
      console.info('[ConnectionManager] Connecting to WebSocket...');

      this.ws = new WebSocket(this.config.wsUrl);

      this.ws.onopen = () => {
        console.info('[ConnectionManager] WebSocket connected');
        this.state.mode = 'websocket';
        this.state.wsConnectedAt = Date.now();
        this.state.reconnectAttempts = 0;
        this.stopPolling();
        this.subscribeToTransfers();
        this.emit('modeChange', 'websocket');
      };

      this.ws.onmessage = (event) => {
        this.handleWebSocketMessage(event.data);
      };

      this.ws.onerror = (error) => {
        console.error('[ConnectionManager] WebSocket error:', error);
      };

      this.ws.onclose = () => {
        console.warn('[ConnectionManager] WebSocket disconnected');
        this.state.wsDisconnectedAt = Date.now();
        this.handleWebSocketDisconnect();
      };
    } catch (error) {
      console.error('[ConnectionManager] Failed to connect WebSocket:', error);
      this.handleWebSocketDisconnect();
    }
  }

  private disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  private handleWebSocketDisconnect(): void {
    if (!this.isRunning) return;

    this.disconnectWebSocket();
    this.startPolling();
    this.scheduleReconnect();
  }

  private subscribeToTransfers(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const subscribeMessage = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_subscribe',
      params: [
        'logs',
        {
          address: this.config.contractAddress,
          topics: [TRANSFER_EVENT_TOPIC],
        },
      ],
    });

    this.ws.send(subscribeMessage);
    console.info('[ConnectionManager] Subscribed to Transfer events');
  }

  private handleWebSocketMessage(data: string): void {
    try {
      const message = JSON.parse(data) as {
        method?: string;
        params?: {
          result?: {
            blockNumber?: string;
            transactionHash?: string;
            blockHash?: string;
            logIndex?: string;
            topics?: string[];
            data?: string;
          };
        };
      };

      if (message.method === 'eth_subscription' && message.params?.result) {
        const log = message.params.result;
        if (log.blockNumber && log.transactionHash) {
          const transferLog = this.parseTransferLog(log);
          if (transferLog) {
            this.state.lastBlockNumber = transferLog.blockNumber;
            this.emit('transfer', transferLog);
          }
        }
      }
    } catch (error) {
      console.error('[ConnectionManager] Failed to parse WebSocket message:', error);
    }
  }

  private parseTransferLog(log: {
    blockNumber?: string;
    transactionHash?: string;
    blockHash?: string;
    logIndex?: string;
    topics?: string[];
    data?: string;
  }): TransferLog | null {
    if (!log.topics || log.topics.length < 3 || !log.data) {
      return null;
    }

    return {
      transactionHash: log.transactionHash!,
      blockNumber: parseInt(log.blockNumber!, 16),
      blockHash: log.blockHash!,
      logIndex: parseInt(log.logIndex!, 16),
      from: '0x' + log.topics[1].slice(26),
      to: '0x' + log.topics[2].slice(26),
      value: log.data,
    };
  }

  private startPolling(): void {
    if (this.pollingInterval) return;

    console.info('[ConnectionManager] Starting HTTP polling mode');
    this.state.mode = 'polling';
    this.emit('modeChange', 'polling');

    this.pollingInterval = setInterval(async () => {
      await this.pollForLogs();
    }, this.config.pollingIntervalMs);

    this.pollForLogs();
  }

  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.info('[ConnectionManager] Stopped HTTP polling');
    }
  }

  async pollForLogs(): Promise<TransferLog[]> {
    try {
      const fromBlock = this.state.lastBlockNumber ? this.state.lastBlockNumber + 1 : 'latest';
      const currentBlock = await this.fetchCurrentBlockNumber();

      if (typeof fromBlock === 'number' && fromBlock > currentBlock) {
        return [];
      }

      const toBlock = Math.min(
        currentBlock,
        typeof fromBlock === 'number'
          ? fromBlock + CHAIN_WATCHER.MAX_BLOCKS_PER_POLL - 1
          : currentBlock,
      );

      const logs = await this.fetchLogs(fromBlock, toBlock);

      if (logs.length > 0) {
        const maxBlock = Math.max(...logs.map((l) => l.blockNumber));
        this.state.lastBlockNumber = maxBlock;
      } else if (typeof fromBlock === 'number') {
        this.state.lastBlockNumber = toBlock;
      } else {
        this.state.lastBlockNumber = currentBlock;
      }

      for (const log of logs) {
        this.emit('transfer', log);
      }

      return logs;
    } catch (error) {
      console.error('[ConnectionManager] Polling error:', error);
      return [];
    }
  }

  private async fetchCurrentBlockNumber(): Promise<number> {
    const response = await fetch(this.config.httpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_blockNumber',
        params: [],
      }),
    });

    const data = (await response.json()) as { result: string };
    return parseInt(data.result, 16);
  }

  private async fetchLogs(fromBlock: number | 'latest', toBlock: number): Promise<TransferLog[]> {
    const response = await fetch(this.config.httpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getLogs',
        params: [
          {
            address: this.config.contractAddress,
            topics: [TRANSFER_EVENT_TOPIC],
            fromBlock: typeof fromBlock === 'number' ? '0x' + fromBlock.toString(16) : fromBlock,
            toBlock: '0x' + toBlock.toString(16),
          },
        ],
      }),
    });

    const data = (await response.json()) as {
      result: Array<{
        transactionHash: string;
        blockNumber: string;
        blockHash: string;
        logIndex: string;
        topics: string[];
        data: string;
      }>;
    };

    return data.result
      .map((log) => this.parseTransferLog(log))
      .filter((log): log is TransferLog => log !== null);
  }

  private scheduleReconnect(): void {
    if (!this.isRunning || this.reconnectTimeout) return;

    const delay = Math.min(
      CHAIN_WATCHER.WS_RECONNECT_DELAY_MS *
        Math.pow(CHAIN_WATCHER.WS_RECONNECT_BACKOFF_MULTIPLIER, this.state.reconnectAttempts),
      CHAIN_WATCHER.WS_RECONNECT_MAX_DELAY_MS,
    );

    this.state.reconnectAttempts++;

    console.info(
      `[ConnectionManager] Scheduling WebSocket reconnect in ${delay}ms (attempt ${this.state.reconnectAttempts})`,
    );

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      await this.connectWebSocket();
    }, delay);
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }
}
