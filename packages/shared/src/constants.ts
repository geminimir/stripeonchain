import { SupportedChain } from './types';

export const USDC_CONTRACTS: Record<SupportedChain, string> = {
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  solana: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};

export const USDC_DECIMALS = 6;

export const CORRELATION_DEFAULTS = {
  AMOUNT_TOLERANCE_MICRO_USDC: 10_000, // 0.01 USDC
  TIMING_WINDOW_MS: 30 * 60 * 1000, // 30 minutes
  MIN_CONFIDENCE: 0.5,
};

export const WEBHOOK_RETRY = {
  MAX_ATTEMPTS: 5,
  INITIAL_DELAY_MS: 5_000,
  MAX_DELAY_MS: 3_600_000, // 1 hour
  BACKOFF_MULTIPLIER: 2,
};

export const REDIS_STREAMS = {
  STRIPE_EVENTS: 'stripe-events',
  CHAIN_TRANSACTIONS: 'chain-transactions',
  CORRELATION_RESULTS: 'correlation-results',
  WEBHOOK_EVENTS: 'webhook-events',
};

export const RPC_HEALTH_CHECK = {
  INTERVAL_MS: 10_000,
  MAX_CONSECUTIVE_FAILURES: 3,
  STALE_BLOCK_THRESHOLD_MS: 30_000,
};
