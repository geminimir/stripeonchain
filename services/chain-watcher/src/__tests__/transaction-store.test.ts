import { InMemoryTransactionStore, InsertableTransaction } from '../transaction-store';

describe('InMemoryTransactionStore', () => {
  let store: InMemoryTransactionStore;

  beforeEach(() => {
    store = new InMemoryTransactionStore();
  });

  afterEach(() => {
    store.clear();
  });

  const createTransaction = (
    overrides: Partial<InsertableTransaction> = {},
  ): InsertableTransaction => ({
    chain: 'base',
    tx_hash: '0x' + Math.random().toString(16).slice(2),
    block_number: 12345,
    block_hash: '0xblockhash',
    sender_address: '0xsender',
    receiver_address: '0xreceiver',
    token_contract: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    token_amount: '1000000',
    ...overrides,
  });

  describe('insertTransaction', () => {
    it('inserts a new transaction', async () => {
      const tx = createTransaction({ tx_hash: '0xunique1' });

      await store.insertTransaction(tx);

      const exists = await store.transactionExists('base', '0xunique1');
      expect(exists).toBe(true);
    });

    it('does not insert duplicate transactions', async () => {
      const tx = createTransaction({ tx_hash: '0xduplicate' });

      await store.insertTransaction(tx);
      await store.insertTransaction(tx);

      const all = store.getAll();
      expect(all).toHaveLength(1);
    });

    it('allows same tx_hash on different chains', async () => {
      const txBase = createTransaction({ chain: 'base', tx_hash: '0xsamehash' });
      const txEth = createTransaction({ chain: 'ethereum', tx_hash: '0xsamehash' });

      await store.insertTransaction(txBase);
      await store.insertTransaction(txEth);

      const all = store.getAll();
      expect(all).toHaveLength(2);
    });
  });

  describe('transactionExists', () => {
    it('returns true for existing transactions', async () => {
      const tx = createTransaction({ tx_hash: '0xexists' });
      await store.insertTransaction(tx);

      const exists = await store.transactionExists('base', '0xexists');
      expect(exists).toBe(true);
    });

    it('returns false for non-existing transactions', async () => {
      const exists = await store.transactionExists('base', '0xnonexistent');
      expect(exists).toBe(false);
    });

    it('returns false for wrong chain', async () => {
      const tx = createTransaction({ chain: 'base', tx_hash: '0xwrongchain' });
      await store.insertTransaction(tx);

      const exists = await store.transactionExists('ethereum', '0xwrongchain');
      expect(exists).toBe(false);
    });
  });

  describe('getAll', () => {
    it('returns all inserted transactions', async () => {
      const tx1 = createTransaction({ tx_hash: '0xtx1' });
      const tx2 = createTransaction({ tx_hash: '0xtx2' });

      await store.insertTransaction(tx1);
      await store.insertTransaction(tx2);

      const all = store.getAll();
      expect(all).toHaveLength(2);
    });

    it('returns empty array when no transactions', () => {
      const all = store.getAll();
      expect(all).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('removes all transactions', async () => {
      await store.insertTransaction(createTransaction({ tx_hash: '0xtx1' }));
      await store.insertTransaction(createTransaction({ tx_hash: '0xtx2' }));

      store.clear();

      const all = store.getAll();
      expect(all).toHaveLength(0);
    });
  });

  describe('close', () => {
    it('clears the store', async () => {
      await store.insertTransaction(createTransaction({ tx_hash: '0xtx1' }));

      await store.close();

      const all = store.getAll();
      expect(all).toHaveLength(0);
    });
  });
});
