import { Pool } from 'pg';
import { EventStore, InsertableEvent } from '../../event-store';

export class PostgresEventStore implements EventStore {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async insertEvent(event: InsertableEvent): Promise<void> {
    const query = `
      INSERT INTO stripe_payment_events (
        event_id, event_type, payment_intent_id, amount, currency,
        payment_method_type, chain_hint, token_hint, payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;

    await this.pool.query(query, [
      event.event_id,
      event.event_type,
      event.payment_intent_id,
      event.amount,
      event.currency,
      event.payment_method_type,
      event.chain_hint,
      event.token_hint,
      JSON.stringify(event.payload),
    ]);
  }

  async eventExists(eventId: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM stripe_payment_events WHERE event_id = $1',
      [eventId],
    );
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getEvent(eventId: string): Promise<InsertableEvent | null> {
    const result = await this.pool.query(
      `SELECT event_id, event_type, payment_intent_id, amount, currency,
              payment_method_type, chain_hint, token_hint, payload
       FROM stripe_payment_events WHERE event_id = $1`,
      [eventId],
    );

    if (result.rowCount === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      event_id: row.event_id,
      event_type: row.event_type,
      payment_intent_id: row.payment_intent_id,
      amount: row.amount,
      currency: row.currency,
      payment_method_type: row.payment_method_type,
      chain_hint: row.chain_hint,
      token_hint: row.token_hint,
      payload: row.payload,
    };
  }

  async clearEvents(): Promise<void> {
    await this.pool.query('DELETE FROM stripe_payment_events');
  }

  async countEvents(): Promise<number> {
    const result = await this.pool.query('SELECT COUNT(*) FROM stripe_payment_events');
    return parseInt(result.rows[0].count, 10);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  getPool(): Pool {
    return this.pool;
  }
}
