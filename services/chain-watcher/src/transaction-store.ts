import { Pool } from 'pg';
import { ChainTransaction, SupportedChain } from '@stripeonchain/shared';

export interface InsertableTransaction {
  chain: SupportedChain;
  tx_hash: string;
  block_number: number;
  block_hash: string;
  sender_address: string;
  receiver_address: string;
  token_contract: string;
  token_amount: string;
}

export interface TransactionStore {
  insertTransaction(tx: InsertableTransaction): Promise<void>;
  transactionExists(chain: SupportedChain, txHash: string): Promise<boolean>;
  close(): Promise<void>;
}

export class PostgresTransactionStore implements TransactionStore {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async insertTransaction(tx: InsertableTransaction): Promise<void> {
    const query = `
      INSERT INTO chain_transactions (
        chain, tx_hash, block_number, block_hash,
        sender_address, receiver_address, token_contract, token_amount,
        receipt
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (chain, tx_hash) DO NOTHING
    `;

    await this.pool.query(query, [
      tx.chain,
      tx.tx_hash,
      tx.block_number,
      tx.block_hash,
      tx.sender_address,
      tx.receiver_address,
      tx.token_contract,
      tx.token_amount,
      JSON.stringify({}),
    ]);
  }

  async transactionExists(chain: SupportedChain, txHash: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM chain_transactions WHERE chain = $1 AND tx_hash = $2',
      [chain, txHash],
    );
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getTransaction(chain: SupportedChain, txHash: string): Promise<ChainTransaction | null> {
    const result = await this.pool.query(
      `SELECT id, chain, tx_hash, block_number, block_hash,
              sender_address, receiver_address, token_contract, token_amount,
              confirmation_count, finality_status, receipt, detected_at, finalized_at
       FROM chain_transactions WHERE chain = $1 AND tx_hash = $2`,
      [chain, txHash],
    );

    if (result.rowCount === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      chain: row.chain,
      tx_hash: row.tx_hash,
      block_number: row.block_number,
      block_hash: row.block_hash,
      sender_address: row.sender_address,
      receiver_address: row.receiver_address,
      token_contract: row.token_contract,
      token_amount: row.token_amount,
      confirmation_count: row.confirmation_count,
      finality_status: row.finality_status,
      receipt: row.receipt,
      detected_at: row.detected_at,
      finalized_at: row.finalized_at,
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class InMemoryTransactionStore implements TransactionStore {
  private transactions: Map<string, InsertableTransaction> = new Map();

  private makeKey(chain: SupportedChain, txHash: string): string {
    return `${chain}:${txHash}`;
  }

  async insertTransaction(tx: InsertableTransaction): Promise<void> {
    const key = this.makeKey(tx.chain, tx.tx_hash);
    if (!this.transactions.has(key)) {
      this.transactions.set(key, tx);
    }
  }

  async transactionExists(chain: SupportedChain, txHash: string): Promise<boolean> {
    return this.transactions.has(this.makeKey(chain, txHash));
  }

  getAll(): InsertableTransaction[] {
    return Array.from(this.transactions.values());
  }

  clear(): void {
    this.transactions.clear();
  }

  async close(): Promise<void> {
    this.transactions.clear();
  }
}
