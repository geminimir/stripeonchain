import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://stripeonchain:stripeonchain_dev@localhost:5432/stripeonchain';

async function seed() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    console.info('Seeding database...');

    await pool.query(`
      INSERT INTO webhook_endpoints (id, url, signing_secret, chains, active)
      VALUES
        (
          'a0000000-0000-0000-0000-000000000001',
          'https://example.com/webhooks/chain',
          'whsec_test_secret_1',
          '{base,ethereum}',
          true
        ),
        (
          'a0000000-0000-0000-0000-000000000002',
          'https://example.com/webhooks/all-chains',
          'whsec_test_secret_2',
          '{base,ethereum,polygon,solana}',
          true
        )
      ON CONFLICT (id) DO NOTHING;
    `);

    await pool.query(`
      INSERT INTO stripe_payment_events (id, event_id, event_type, payment_intent_id, amount, currency, payment_method_type, chain_hint, token_hint, payload)
      VALUES
        (
          'b0000000-0000-0000-0000-000000000001',
          'evt_test_001',
          'payment_intent.succeeded',
          'pi_test_001',
          1000000,
          'usd',
          'crypto',
          'base',
          'usdc',
          '{"id": "evt_test_001", "type": "payment_intent.succeeded"}'::jsonb
        ),
        (
          'b0000000-0000-0000-0000-000000000002',
          'evt_test_002',
          'payment_intent.succeeded',
          'pi_test_002',
          5000000,
          'usd',
          'crypto',
          'ethereum',
          'usdc',
          '{"id": "evt_test_002", "type": "payment_intent.succeeded"}'::jsonb
        )
      ON CONFLICT (event_id) DO NOTHING;
    `);

    await pool.query(`
      INSERT INTO chain_transactions (id, chain, tx_hash, block_number, block_hash, sender_address, receiver_address, token_contract, token_amount, confirmation_count, finality_status)
      VALUES
        (
          'c0000000-0000-0000-0000-000000000001',
          'base',
          '0xabc123def456789',
          12345678,
          '0xblockhash123',
          '0xsender111',
          '0xreceiver222',
          '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          1000000,
          10,
          'finalized'
        )
      ON CONFLICT ON CONSTRAINT chain_transactions_chain_tx_hash_unique DO NOTHING;
    `);

    console.info('Seed data inserted successfully.');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
