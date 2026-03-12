import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
  `);

  // -- Enum types --
  pgm.createType('supported_chain', ['ethereum', 'base', 'polygon', 'solana']);
  pgm.createType('finality_status', ['pending', 'soft_confirmed', 'finalized', 'failed']);
  pgm.createType('delivery_status', ['pending', 'succeeded', 'failed']);

  // -- stripe_payment_events --
  pgm.createTable('stripe_payment_events', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    event_id: {
      type: 'varchar(255)',
      notNull: true,
      unique: true,
    },
    event_type: {
      type: 'varchar(100)',
      notNull: true,
    },
    payment_intent_id: {
      type: 'varchar(255)',
      notNull: true,
    },
    amount: {
      type: 'numeric(20,0)',
      notNull: true,
      comment: 'Amount in microUSDC (6 decimals)',
    },
    currency: {
      type: 'varchar(10)',
      notNull: true,
      default: pgm.func("'usd'"),
    },
    payment_method_type: {
      type: 'varchar(50)',
      notNull: true,
    },
    chain_hint: {
      type: 'supported_chain',
    },
    token_hint: {
      type: 'varchar(100)',
    },
    payload: {
      type: 'jsonb',
      notNull: true,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    processed_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('stripe_payment_events', 'payment_intent_id');
  pgm.createIndex('stripe_payment_events', 'event_type');
  pgm.createIndex('stripe_payment_events', 'created_at');

  // -- chain_transactions --
  pgm.createTable('chain_transactions', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    chain: {
      type: 'supported_chain',
      notNull: true,
    },
    tx_hash: {
      type: 'varchar(128)',
      notNull: true,
    },
    block_number: {
      type: 'bigint',
      notNull: true,
    },
    block_hash: {
      type: 'varchar(128)',
      notNull: true,
    },
    sender_address: {
      type: 'varchar(128)',
      notNull: true,
    },
    receiver_address: {
      type: 'varchar(128)',
      notNull: true,
    },
    token_contract: {
      type: 'varchar(128)',
      notNull: true,
    },
    token_amount: {
      type: 'numeric(30,0)',
      notNull: true,
      comment: 'Raw token amount (microUSDC for USDC)',
    },
    confirmation_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    finality_status: {
      type: 'finality_status',
      notNull: true,
      default: pgm.func("'pending'"),
    },
    receipt: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func("'{}'"),
    },
    detected_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    finalized_at: {
      type: 'timestamptz',
    },
  });

  pgm.addConstraint('chain_transactions', 'chain_transactions_chain_tx_hash_unique', {
    unique: ['chain', 'tx_hash'],
  });
  pgm.createIndex('chain_transactions', 'receiver_address');
  pgm.createIndex('chain_transactions', 'finality_status');
  pgm.createIndex('chain_transactions', 'detected_at');
  pgm.createIndex('chain_transactions', ['chain', 'block_number']);

  // -- payment_correlations --
  pgm.createTable('payment_correlations', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    stripe_event_id: {
      type: 'uuid',
      notNull: true,
      references: '"stripe_payment_events"',
      onDelete: 'CASCADE',
    },
    chain_transaction_id: {
      type: 'uuid',
      notNull: true,
      references: '"chain_transactions"',
      onDelete: 'CASCADE',
    },
    correlation_confidence: {
      type: 'numeric(3,2)',
      notNull: true,
      comment: 'Score from 0.00 to 1.00',
    },
    matched_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    discrepancies: {
      type: 'jsonb',
    },
  });

  pgm.addConstraint('payment_correlations', 'payment_correlations_unique_pair', {
    unique: ['stripe_event_id', 'chain_transaction_id'],
  });
  pgm.createIndex('payment_correlations', 'stripe_event_id');
  pgm.createIndex('payment_correlations', 'chain_transaction_id');

  // -- webhook_endpoints --
  pgm.createTable('webhook_endpoints', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    url: {
      type: 'varchar(2048)',
      notNull: true,
    },
    signing_secret: {
      type: 'varchar(255)',
      notNull: true,
    },
    chains: {
      type: 'supported_chain[]',
      notNull: true,
      default: pgm.func("'{}'"),
    },
    active: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('webhook_endpoints', 'active');

  // -- webhook_deliveries --
  pgm.createTable('webhook_deliveries', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    webhook_endpoint_id: {
      type: 'uuid',
      notNull: true,
      references: '"webhook_endpoints"',
      onDelete: 'CASCADE',
    },
    event_type: {
      type: 'varchar(100)',
      notNull: true,
    },
    event_id: {
      type: 'varchar(255)',
      notNull: true,
    },
    payload: {
      type: 'jsonb',
      notNull: true,
    },
    delivery_status: {
      type: 'delivery_status',
      notNull: true,
      default: pgm.func("'pending'"),
    },
    http_status_code: {
      type: 'integer',
    },
    attempt_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    max_attempts: {
      type: 'integer',
      notNull: true,
      default: 5,
    },
    next_retry_at: {
      type: 'timestamptz',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    delivered_at: {
      type: 'timestamptz',
    },
  });

  pgm.addConstraint('webhook_deliveries', 'webhook_deliveries_idempotent', {
    unique: ['webhook_endpoint_id', 'event_id'],
  });
  pgm.createIndex('webhook_deliveries', 'delivery_status');
  pgm.createIndex('webhook_deliveries', 'next_retry_at');
  pgm.createIndex('webhook_deliveries', 'webhook_endpoint_id');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('webhook_deliveries');
  pgm.dropTable('webhook_endpoints');
  pgm.dropTable('payment_correlations');
  pgm.dropTable('chain_transactions');
  pgm.dropTable('stripe_payment_events');

  pgm.dropType('delivery_status');
  pgm.dropType('finality_status');
  pgm.dropType('supported_chain');
}
