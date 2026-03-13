export type SupportedChain = 'ethereum' | 'base' | 'polygon' | 'solana';

export type FinalityStatus = 'pending' | 'soft_confirmed' | 'finalized' | 'failed';

export type RpcHealthStatus = 'healthy' | 'unhealthy' | 'unknown';

export interface RpcProviderConfig {
  url: string;
  name: string;
  priority: number;
}

export interface RpcHealthState {
  status: RpcHealthStatus;
  lastBlockNumber: number | null;
  lastBlockTimestamp: number | null;
  consecutiveFailures: number;
  lastCheckAt: number | null;
  lastSuccessAt: number | null;
}

export type DeliveryStatus = 'pending' | 'succeeded' | 'failed';

export type MismatchType =
  | 'amount_mismatch'
  | 'missing_transfer'
  | 'timing_anomaly'
  | 'duplicate_transfer';

export type WebhookEventType =
  | 'chain.tx.detected'
  | 'chain.tx.confirming'
  | 'chain.tx.finalized'
  | 'chain.tx.failed'
  | 'chain.reorg.detected'
  | 'reconciliation.mismatch';

export interface StripePaymentEvent {
  id: string;
  event_id: string;
  event_type: string;
  payment_intent_id: string;
  amount: string;
  currency: string;
  payment_method_type: string;
  chain_hint: SupportedChain | null;
  token_hint: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
  processed_at: Date;
}

export interface ChainTransaction {
  id: string;
  chain: SupportedChain;
  tx_hash: string;
  block_number: number;
  block_hash: string;
  sender_address: string;
  receiver_address: string;
  token_contract: string;
  token_amount: string;
  confirmation_count: number;
  finality_status: FinalityStatus;
  receipt: Record<string, unknown>;
  detected_at: Date;
  finalized_at: Date | null;
}

export interface PaymentCorrelation {
  id: string;
  stripe_event_id: string;
  chain_transaction_id: string;
  correlation_confidence: number;
  matched_at: Date;
  discrepancies: Record<string, unknown> | null;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  signing_secret: string;
  chains: SupportedChain[];
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface WebhookDelivery {
  id: string;
  webhook_endpoint_id: string;
  event_type: WebhookEventType;
  event_id: string;
  payload: Record<string, unknown>;
  delivery_status: DeliveryStatus;
  http_status_code: number | null;
  attempt_count: number;
  max_attempts: number;
  next_retry_at: Date | null;
  created_at: Date;
  delivered_at: Date | null;
}
