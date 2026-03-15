import { TransferLog } from '@stripeonchain/shared';
import { BaseChainWatcher } from '../base-chain-watcher';
import { InMemoryTransactionStore } from '../transaction-store';

const mockConnectionManager = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn(),
  mode: 'disconnected',
  on: jest.fn(),
  emit: jest.fn(),
};

jest.mock('../connection-manager', () => ({
  ConnectionManager: jest.fn().mockImplementation(() => mockConnectionManager),
}));

describe('BaseChainWatcher', () => {
  let watcher: BaseChainWatcher;
  let store: InMemoryTransactionStore;
  let transferHandler: (log: TransferLog) => void;

  const merchantAddress1 = '0x1234567890123456789012345678901234567890';
  const merchantAddress2 = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
  const nonMerchantAddress = '0x9999999999999999999999999999999999999999';

  beforeEach(() => {
    jest.clearAllMocks();
    store = new InMemoryTransactionStore();

    mockConnectionManager.on.mockImplementation((event: string, handler: () => void) => {
      if (event === 'transfer') {
        transferHandler = handler;
      }
    });

    watcher = new BaseChainWatcher({
      httpUrl: 'http://localhost:8545',
      wsUrl: 'ws://localhost:8546',
      merchantAddresses: [merchantAddress1, merchantAddress2],
      transactionStore: store,
    });
  });

  afterEach(() => {
    watcher.stop();
    store.clear();
  });

  describe('merchant address management', () => {
    it('initializes with provided merchant addresses', () => {
      expect(watcher.merchantAddressCount).toBe(2);
      expect(watcher.hasMerchantAddress(merchantAddress1)).toBe(true);
      expect(watcher.hasMerchantAddress(merchantAddress2)).toBe(true);
    });

    it('normalizes addresses to lowercase', () => {
      expect(watcher.hasMerchantAddress(merchantAddress1.toUpperCase())).toBe(true);
    });

    it('adds new merchant addresses', () => {
      const newAddress = '0xnewaddressnewaddressnewaddressnewaddress';
      watcher.addMerchantAddress(newAddress);
      expect(watcher.merchantAddressCount).toBe(3);
      expect(watcher.hasMerchantAddress(newAddress)).toBe(true);
    });

    it('removes merchant addresses', () => {
      watcher.removeMerchantAddress(merchantAddress1);
      expect(watcher.merchantAddressCount).toBe(1);
      expect(watcher.hasMerchantAddress(merchantAddress1)).toBe(false);
    });
  });

  describe('transfer filtering', () => {
    it('emits merchantTransfer for transfers to merchant addresses', async () => {
      const merchantTransferSpy = jest.fn();
      watcher.on('merchantTransfer', merchantTransferSpy);

      await watcher.start();

      const log: TransferLog = {
        transactionHash: '0xtxhash1',
        blockNumber: 12345,
        blockHash: '0xblockhash1',
        logIndex: 0,
        from: '0xsender',
        to: merchantAddress1,
        value: '0x5f5e100',
      };

      transferHandler(log);

      expect(merchantTransferSpy).toHaveBeenCalledWith(log);
      expect(watcher.statistics.transfersDetected).toBe(1);
      expect(watcher.statistics.transfersFiltered).toBe(0);
    });

    it('filters out transfers to non-merchant addresses', async () => {
      const merchantTransferSpy = jest.fn();
      watcher.on('merchantTransfer', merchantTransferSpy);

      await watcher.start();

      const log: TransferLog = {
        transactionHash: '0xtxhash2',
        blockNumber: 12346,
        blockHash: '0xblockhash2',
        logIndex: 0,
        from: '0xsender',
        to: nonMerchantAddress,
        value: '0x5f5e100',
      };

      transferHandler(log);

      expect(merchantTransferSpy).not.toHaveBeenCalled();
      expect(watcher.statistics.transfersDetected).toBe(1);
      expect(watcher.statistics.transfersFiltered).toBe(1);
    });

    it('handles case-insensitive address matching', async () => {
      const merchantTransferSpy = jest.fn();
      watcher.on('merchantTransfer', merchantTransferSpy);

      await watcher.start();

      const log: TransferLog = {
        transactionHash: '0xtxhash3',
        blockNumber: 12347,
        blockHash: '0xblockhash3',
        logIndex: 0,
        from: '0xsender',
        to: merchantAddress1.toUpperCase(),
        value: '0x5f5e100',
      };

      transferHandler(log);

      expect(merchantTransferSpy).toHaveBeenCalled();
    });
  });

  describe('transaction storage', () => {
    it('stores merchant transfers in the transaction store', async () => {
      const storedSpy = jest.fn();
      watcher.on('transactionStored', storedSpy);

      await watcher.start();

      const log: TransferLog = {
        transactionHash: '0xtxhash4',
        blockNumber: 12348,
        blockHash: '0xblockhash4',
        logIndex: 0,
        from: '0xsenderaddress',
        to: merchantAddress1,
        value: '0x5f5e100',
      };

      transferHandler(log);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(storedSpy).toHaveBeenCalled();
      expect(watcher.statistics.transfersStored).toBe(1);

      const transactions = store.getAll();
      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toMatchObject({
        chain: 'base',
        tx_hash: '0xtxhash4',
        block_number: 12348,
        sender_address: '0xsenderaddress',
        receiver_address: merchantAddress1.toLowerCase(),
      });
    });

    it('skips duplicate transactions', async () => {
      await watcher.start();

      const log: TransferLog = {
        transactionHash: '0xtxhash5',
        blockNumber: 12349,
        blockHash: '0xblockhash5',
        logIndex: 0,
        from: '0xsender',
        to: merchantAddress1,
        value: '0x5f5e100',
      };

      transferHandler(log);
      await new Promise((resolve) => setTimeout(resolve, 10));

      transferHandler(log);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(watcher.statistics.transfersStored).toBe(1);
      expect(watcher.statistics.duplicatesSkipped).toBe(1);

      const transactions = store.getAll();
      expect(transactions).toHaveLength(1);
    });
  });

  describe('amount parsing', () => {
    it('correctly parses USDC amounts (6 decimals)', async () => {
      await watcher.start();

      const log: TransferLog = {
        transactionHash: '0xtxhash6',
        blockNumber: 12350,
        blockHash: '0xblockhash6',
        logIndex: 0,
        from: '0xsender',
        to: merchantAddress1,
        value: '0x5f5e100',
      };

      transferHandler(log);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const transactions = store.getAll();
      expect(transactions[0].token_amount).toBe('100000000');
    });
  });

  describe('lifecycle', () => {
    it('starts the connection manager', async () => {
      await watcher.start();
      expect(mockConnectionManager.start).toHaveBeenCalled();
    });

    it('stops the connection manager', async () => {
      await watcher.start();
      watcher.stop();
      expect(mockConnectionManager.stop).toHaveBeenCalled();
    });

    it('does not start twice', async () => {
      await watcher.start();
      await watcher.start();
      expect(mockConnectionManager.start).toHaveBeenCalledTimes(1);
    });
  });
});
