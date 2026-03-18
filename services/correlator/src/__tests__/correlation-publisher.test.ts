import { RedisCorrelationPublisher } from '../correlation-publisher';
import { CorrelationResult, CorrelationCandidate } from '@stripeonchain/shared';

const mockRedis = {
  xadd: jest.fn(),
  setex: jest.fn(),
  exists: jest.fn(),
  quit: jest.fn(),
};

describe('RedisCorrelationPublisher', () => {
  let publisher: RedisCorrelationPublisher;

  const sampleResult: CorrelationResult = {
    stripe_event_id: 'evt_123',
    chain_tx_hash: '0xabc123',
    chain: 'base',
    confidence: 0.95,
    match_details: {
      amountMatch: true,
      amountDelta: 0,
      timingMatch: true,
      timingDeltaMs: 60000,
      chainMatch: true,
      tokenMatch: true,
    },
    correlated_at: '2026-03-15T12:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    publisher = new RedisCorrelationPublisher(mockRedis as any);
  });

  describe('publish', () => {
    it('should publish correlation result to Redis stream', async () => {
      mockRedis.exists.mockResolvedValueOnce(0);
      mockRedis.xadd.mockResolvedValueOnce('1234567890-0');
      mockRedis.setex.mockResolvedValueOnce('OK');

      const messageId = await publisher.publish(sampleResult);

      expect(messageId).toBe('1234567890-0');
      expect(mockRedis.xadd).toHaveBeenCalledWith(
        'correlation-results',
        '*',
        'stripe_event_id',
        'evt_123',
        'chain_tx_hash',
        '0xabc123',
        'chain',
        'base',
        'confidence',
        '0.95',
        'amount_match',
        'true',
        'amount_delta',
        '0',
        'timing_match',
        'true',
        'timing_delta_ms',
        '60000',
        'chain_match',
        'true',
        'token_match',
        'true',
        'correlated_at',
        '2026-03-15T12:00:00.000Z',
      );
    });

    it('should not publish duplicate correlation', async () => {
      mockRedis.exists.mockResolvedValueOnce(1);

      const messageId = await publisher.publish(sampleResult);

      expect(messageId).toBe('');
      expect(mockRedis.xadd).not.toHaveBeenCalled();
    });

    it('should set dedup key after publishing', async () => {
      mockRedis.exists.mockResolvedValueOnce(0);
      mockRedis.xadd.mockResolvedValueOnce('1234567890-0');
      mockRedis.setex.mockResolvedValueOnce('OK');

      await publisher.publish(sampleResult);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'correlation:published:evt_123:0xabc123',
        7 * 24 * 60 * 60,
        '1',
      );
    });
  });

  describe('isPublished', () => {
    it('should return true when correlation already published', async () => {
      mockRedis.exists.mockResolvedValueOnce(1);

      const result = await publisher.isPublished('evt_123', '0xabc');

      expect(result).toBe(true);
      expect(mockRedis.exists).toHaveBeenCalledWith('correlation:published:evt_123:0xabc');
    });

    it('should return false when correlation not published', async () => {
      mockRedis.exists.mockResolvedValueOnce(0);

      const result = await publisher.isPublished('evt_456', '0xdef');

      expect(result).toBe(false);
    });
  });

  describe('fromCandidate', () => {
    it('should convert CorrelationCandidate to CorrelationResult', () => {
      const candidate: CorrelationCandidate = {
        stripeEvent: {
          event_id: 'evt_789',
          payment_intent_id: 'pi_123',
          amount: '1000000',
          chain: 'base',
          token: '0xusdc',
          timestamp: '2026-03-15T12:00:00.000Z',
        },
        chainTransaction: {
          chain: 'base',
          tx_hash: '0xtx789',
          block_number: 12345,
          block_hash: '0xblock',
          amount: '0xf4240',
          sender: '0xsender',
          receiver: '0xreceiver',
          token_contract: '0xusdc',
          detected_at: '2026-03-15T12:01:00.000Z',
        },
        confidence: 0.98,
        matchDetails: {
          amountMatch: true,
          amountDelta: 0,
          timingMatch: true,
          timingDeltaMs: 60000,
          chainMatch: true,
          tokenMatch: true,
        },
      };

      const result = RedisCorrelationPublisher.fromCandidate(candidate);

      expect(result.stripe_event_id).toBe('evt_789');
      expect(result.chain_tx_hash).toBe('0xtx789');
      expect(result.chain).toBe('base');
      expect(result.confidence).toBe(0.98);
      expect(result.match_details).toEqual(candidate.matchDetails);
      expect(result.correlated_at).toBeDefined();
    });
  });

  describe('close', () => {
    it('should close Redis connection', async () => {
      mockRedis.quit.mockResolvedValueOnce('OK');

      await publisher.close();

      expect(mockRedis.quit).toHaveBeenCalled();
    });
  });
});
