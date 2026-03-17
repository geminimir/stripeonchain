import { CorrelationEngine } from '../correlation-engine';
import { StripeEventMessage, ChainTransactionMessage } from '@stripeonchain/shared';

describe('CorrelationEngine', () => {
  let engine: CorrelationEngine;

  const createStripeEvent = (overrides: Partial<StripeEventMessage> = {}): StripeEventMessage => ({
    event_id: 'evt_123',
    payment_intent_id: 'pi_456',
    amount: '1000000', // 1 USDC in micro units
    chain: 'base',
    token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    timestamp: '2026-03-15T12:00:00.000Z',
    ...overrides,
  });

  const createChainTx = (
    overrides: Partial<ChainTransactionMessage> = {},
  ): ChainTransactionMessage => ({
    chain: 'base',
    tx_hash: '0xabc123',
    block_number: 12345,
    block_hash: '0xblock123',
    amount: '0x' + (1000000).toString(16), // 1 USDC in hex
    sender: '0xsender',
    receiver: '0xreceiver',
    token_contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    detected_at: '2026-03-15T12:05:00.000Z', // 5 minutes later
    ...overrides,
  });

  beforeEach(() => {
    engine = new CorrelationEngine();
  });

  describe('exact match (all four dimensions)', () => {
    it('should produce confidence >= 0.95 for perfect match', () => {
      const event = createStripeEvent();
      const tx = createChainTx({
        detected_at: '2026-03-15T12:00:00.000Z', // same time
      });

      const match = engine.evaluateMatch(event, tx);

      expect(match).not.toBeNull();
      expect(match!.confidence).toBeGreaterThanOrEqual(0.95);
    });

    it('should match amount, timing, chain, and token', () => {
      const event = createStripeEvent();
      const tx = createChainTx({
        detected_at: '2026-03-15T12:00:00.000Z',
      });

      const match = engine.evaluateMatch(event, tx);

      expect(match!.matchDetails.amountMatch).toBe(true);
      expect(match!.matchDetails.timingMatch).toBe(true);
      expect(match!.matchDetails.chainMatch).toBe(true);
      expect(match!.matchDetails.tokenMatch).toBe(true);
    });
  });

  describe('amount-only match', () => {
    it('should produce lower confidence when only amount matches', () => {
      const event = createStripeEvent({
        chain: 'ethereum', // different chain
        token: '0xdifferenttoken',
      });
      const tx = createChainTx({
        detected_at: '2026-03-15T15:00:00.000Z', // 3 hours later - outside timing window
      });

      const match = engine.evaluateMatch(event, tx);

      expect(match).not.toBeNull();
      expect(match!.confidence).toBeLessThan(0.95);
      expect(match!.confidence).toBeGreaterThanOrEqual(0.4); // amount match base
    });

    it('should return null when amount does not match', () => {
      const event = createStripeEvent({ amount: '2000000' }); // 2 USDC
      const tx = createChainTx(); // 1 USDC

      const match = engine.evaluateMatch(event, tx);

      expect(match).toBeNull();
    });
  });

  describe('no match (pending state)', () => {
    it('should leave stripe event in pending when no chain tx matches', () => {
      const event = createStripeEvent();

      const result = engine.addStripeEvent(event);

      expect(result).toBeNull();
      expect(engine.getPendingStripeEventsCount()).toBe(1);
    });

    it('should leave chain tx in pending when no stripe event matches', () => {
      const tx = createChainTx();

      const result = engine.addChainTransaction(tx);

      expect(result).toBeNull();
      expect(engine.getPendingChainTransactionsCount()).toBe(1);
    });

    it('should match when counterpart arrives later', () => {
      const event = createStripeEvent();
      const tx = createChainTx({ detected_at: '2026-03-15T12:00:00.000Z' });

      engine.addStripeEvent(event);
      expect(engine.getPendingStripeEventsCount()).toBe(1);

      const match = engine.addChainTransaction(tx);

      expect(match).not.toBeNull();
      expect(match!.stripeEvent.event_id).toBe('evt_123');
      expect(match!.chainTransaction.tx_hash).toBe('0xabc123');
      expect(engine.getPendingStripeEventsCount()).toBe(0);
    });
  });

  describe('confidence scoring', () => {
    it('should give higher confidence for closer timing', () => {
      const event = createStripeEvent();

      const txClose = createChainTx({ detected_at: '2026-03-15T12:01:00.000Z' }); // 1 min
      const txFar = createChainTx({ detected_at: '2026-03-15T12:20:00.000Z' }); // 20 min

      const matchClose = engine.evaluateMatch(event, txClose);
      const matchFar = engine.evaluateMatch(event, txFar);

      expect(matchClose!.confidence).toBeGreaterThan(matchFar!.confidence);
    });

    it('should give higher confidence when chain matches', () => {
      const eventWithChain = createStripeEvent({ chain: 'base' });
      const eventNoChain = createStripeEvent({ chain: null });
      const tx = createChainTx({ detected_at: '2026-03-15T12:00:00.000Z' });

      const matchWithChain = engine.evaluateMatch(eventWithChain, tx);
      const matchNoChain = engine.evaluateMatch(eventNoChain, tx);

      expect(matchWithChain!.confidence).toBe(matchNoChain!.confidence);
    });

    it('should fail match when chain explicitly does not match', () => {
      const event = createStripeEvent({ chain: 'ethereum' });
      const tx = createChainTx({ chain: 'base', detected_at: '2026-03-15T12:00:00.000Z' });

      const match = engine.evaluateMatch(event, tx);

      expect(match!.matchDetails.chainMatch).toBe(false);
      expect(match!.confidence).toBeLessThan(0.95);
    });
  });

  describe('amount tolerance', () => {
    it('should match amounts within tolerance', () => {
      const event = createStripeEvent({ amount: '1000000' });
      const tx = createChainTx({
        amount: '0x' + (1005000).toString(16), // 5000 micro USDC difference
        detected_at: '2026-03-15T12:00:00.000Z',
      });

      const match = engine.evaluateMatch(event, tx);

      expect(match).not.toBeNull();
      expect(match!.matchDetails.amountMatch).toBe(true);
    });

    it('should not match amounts outside tolerance', () => {
      const event = createStripeEvent({ amount: '1000000' });
      const tx = createChainTx({
        amount: '0x' + (1050000).toString(16), // 50000 micro USDC difference
        detected_at: '2026-03-15T12:00:00.000Z',
      });

      const match = engine.evaluateMatch(event, tx);

      expect(match).toBeNull();
    });
  });

  describe('timing window', () => {
    it('should match transactions within 30 minute window', () => {
      const event = createStripeEvent();
      const tx = createChainTx({
        detected_at: '2026-03-15T12:29:00.000Z', // 29 minutes later
      });

      const match = engine.evaluateMatch(event, tx);

      expect(match).not.toBeNull();
      expect(match!.matchDetails.timingMatch).toBe(true);
    });

    it('should not match timing outside window but still match on amount', () => {
      const event = createStripeEvent();
      const tx = createChainTx({
        detected_at: '2026-03-15T13:00:00.000Z', // 1 hour later
      });

      const match = engine.evaluateMatch(event, tx);

      expect(match).not.toBeNull();
      expect(match!.matchDetails.timingMatch).toBe(false);
      expect(match!.matchDetails.amountMatch).toBe(true);
    });
  });

  describe('best match selection', () => {
    it('should select highest confidence match when multiple candidates exist', () => {
      const event = createStripeEvent();

      const txGood = createChainTx({
        tx_hash: '0xgood',
        detected_at: '2026-03-15T12:00:00.000Z',
      });
      const txBad = createChainTx({
        tx_hash: '0xbad',
        detected_at: '2026-03-15T12:25:00.000Z',
      });

      engine.addChainTransaction(txBad);
      engine.addChainTransaction(txGood);

      const match = engine.addStripeEvent(event);

      expect(match).not.toBeNull();
      expect(match!.chainTransaction.tx_hash).toBe('0xgood');
    });
  });

  describe('custom configuration', () => {
    it('should respect custom amount tolerance', () => {
      const customEngine = new CorrelationEngine({
        amountToleranceMicroUsdc: 100, // very strict
      });

      const event = createStripeEvent({ amount: '1000000' });
      const tx = createChainTx({
        amount: '0x' + (1005000).toString(16), // 5000 diff - outside custom tolerance
        detected_at: '2026-03-15T12:00:00.000Z',
      });

      const match = customEngine.evaluateMatch(event, tx);

      expect(match).toBeNull();
    });

    it('should respect custom timing window', () => {
      const customEngine = new CorrelationEngine({
        timingWindowMs: 5 * 60 * 1000, // 5 minutes
      });

      const event = createStripeEvent();
      const tx = createChainTx({
        detected_at: '2026-03-15T12:10:00.000Z', // 10 minutes later
      });

      const match = customEngine.evaluateMatch(event, tx);

      expect(match).not.toBeNull();
      expect(match!.matchDetails.timingMatch).toBe(false);
    });
  });
});
