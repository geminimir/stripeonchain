import {
  CORRELATION_DEFAULTS,
  USDC_CONTRACTS,
  StripeEventMessage,
  ChainTransactionMessage,
  CorrelationCandidate,
  MatchDetails,
} from '@stripeonchain/shared';

export interface CorrelationEngineConfig {
  amountToleranceMicroUsdc?: number;
  timingWindowMs?: number;
  minConfidence?: number;
}

export class CorrelationEngine {
  private config: Required<CorrelationEngineConfig>;
  private pendingStripeEvents: Map<string, StripeEventMessage> = new Map();
  private pendingChainTransactions: Map<string, ChainTransactionMessage> = new Map();

  constructor(config: CorrelationEngineConfig = {}) {
    this.config = {
      amountToleranceMicroUsdc:
        config.amountToleranceMicroUsdc ?? CORRELATION_DEFAULTS.AMOUNT_TOLERANCE_MICRO_USDC,
      timingWindowMs: config.timingWindowMs ?? CORRELATION_DEFAULTS.TIMING_WINDOW_MS,
      minConfidence: config.minConfidence ?? CORRELATION_DEFAULTS.MIN_CONFIDENCE,
    };
  }

  addStripeEvent(event: StripeEventMessage): CorrelationCandidate | null {
    const match = this.findMatchingTransaction(event);

    if (match && match.confidence >= this.config.minConfidence) {
      this.pendingChainTransactions.delete(this.getTxKey(match.chainTransaction));
      return match;
    }

    this.pendingStripeEvents.set(event.event_id, event);
    return null;
  }

  addChainTransaction(tx: ChainTransactionMessage): CorrelationCandidate | null {
    const match = this.findMatchingStripeEvent(tx);

    if (match && match.confidence >= this.config.minConfidence) {
      this.pendingStripeEvents.delete(match.stripeEvent.event_id);
      return match;
    }

    this.pendingChainTransactions.set(this.getTxKey(tx), tx);
    return null;
  }

  private findMatchingTransaction(event: StripeEventMessage): CorrelationCandidate | null {
    let bestMatch: CorrelationCandidate | null = null;

    for (const tx of this.pendingChainTransactions.values()) {
      const candidate = this.evaluateMatch(event, tx);
      if (candidate && (!bestMatch || candidate.confidence > bestMatch.confidence)) {
        bestMatch = candidate;
      }
    }

    return bestMatch;
  }

  private findMatchingStripeEvent(tx: ChainTransactionMessage): CorrelationCandidate | null {
    let bestMatch: CorrelationCandidate | null = null;

    for (const event of this.pendingStripeEvents.values()) {
      const candidate = this.evaluateMatch(event, tx);
      if (candidate && (!bestMatch || candidate.confidence > bestMatch.confidence)) {
        bestMatch = candidate;
      }
    }

    return bestMatch;
  }

  evaluateMatch(
    event: StripeEventMessage,
    tx: ChainTransactionMessage,
  ): CorrelationCandidate | null {
    const matchDetails = this.calculateMatchDetails(event, tx);
    const confidence = this.calculateConfidence(matchDetails);

    if (confidence < this.config.minConfidence) {
      return null;
    }

    return {
      stripeEvent: event,
      chainTransaction: tx,
      confidence,
      matchDetails,
    };
  }

  calculateMatchDetails(event: StripeEventMessage, tx: ChainTransactionMessage): MatchDetails {
    const eventAmountMicroUsdc = this.parseAmount(event.amount);
    const txAmountMicroUsdc = this.parseHexAmount(tx.amount);
    const amountDelta = Math.abs(eventAmountMicroUsdc - txAmountMicroUsdc);
    const amountMatch = amountDelta <= this.config.amountToleranceMicroUsdc;

    const eventTime = new Date(event.timestamp).getTime();
    const txTime = new Date(tx.detected_at).getTime();
    const timingDeltaMs = Math.abs(eventTime - txTime);
    const timingMatch = timingDeltaMs <= this.config.timingWindowMs;

    const chainMatch = event.chain === null || event.chain === tx.chain;

    const expectedContract = event.chain ? USDC_CONTRACTS[event.chain] : null;
    const tokenMatch =
      event.token === null ||
      (event.token !== null && event.token.toLowerCase() === tx.token_contract.toLowerCase()) ||
      (expectedContract !== null &&
        expectedContract.toLowerCase() === tx.token_contract.toLowerCase());

    return {
      amountMatch,
      amountDelta,
      timingMatch,
      timingDeltaMs,
      chainMatch,
      tokenMatch,
    };
  }

  calculateConfidence(details: MatchDetails): number {
    let confidence = 0;

    if (details.amountMatch) {
      const amountScore = 1 - details.amountDelta / (this.config.amountToleranceMicroUsdc * 2);
      confidence += Math.max(0.4, amountScore * 0.5);
    } else {
      return 0;
    }

    if (details.timingMatch) {
      const timingScore = 1 - details.timingDeltaMs / this.config.timingWindowMs;
      confidence += timingScore * 0.25;
    }

    if (details.chainMatch) {
      confidence += 0.15;
    }

    if (details.tokenMatch) {
      confidence += 0.1;
    }

    return Math.min(1, confidence);
  }

  private parseAmount(amount: string): number {
    const parsed = parseInt(amount, 10);
    return isNaN(parsed) ? 0 : parsed;
  }

  private parseHexAmount(hexAmount: string): number {
    if (!hexAmount.startsWith('0x')) {
      return parseInt(hexAmount, 10) || 0;
    }
    return parseInt(hexAmount, 16) || 0;
  }

  private getTxKey(tx: ChainTransactionMessage): string {
    return `${tx.chain}:${tx.tx_hash}`;
  }

  getPendingStripeEventsCount(): number {
    return this.pendingStripeEvents.size;
  }

  getPendingChainTransactionsCount(): number {
    return this.pendingChainTransactions.size;
  }

  getPendingStripeEvents(): StripeEventMessage[] {
    return Array.from(this.pendingStripeEvents.values());
  }

  getPendingChainTransactions(): ChainTransactionMessage[] {
    return Array.from(this.pendingChainTransactions.values());
  }

  clearPending(): void {
    this.pendingStripeEvents.clear();
    this.pendingChainTransactions.clear();
  }
}
