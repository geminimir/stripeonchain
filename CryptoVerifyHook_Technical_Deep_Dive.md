# CryptoVerifyHook

**Unified On-Chain Settlement Verification for Stripe Stablecoin Payments**

*Technical Deep Dive — v1.0 — March 2026*
*Author: Khalil*
*Portfolio project targeting Stripe Backend/API Engineer, Money as a Service (Crypto sub-team)*

---

## Executive Summary

CryptoVerifyHook is an open-source middleware service that bridges the gap between Stripe's payment event system and blockchain settlement reality. It provides independent, on-chain verification of stablecoin payments processed through Stripe, emitting normalized webhook events that mirror Stripe's existing webhook contract — including HMAC-SHA256 signatures, idempotency keys, and exponential backoff retries.

The project addresses a fundamental architectural gap in Stripe's stablecoin payments infrastructure: **Stripe abstracts away the blockchain entirely.** When a customer pays with USDC via Stripe, the merchant receives a `payment_intent.succeeded` event — but has zero visibility into whether the on-chain transfer actually settled, which chain it settled on, what the transaction hash was, or how many block confirmations it has. For businesses that need proof of settlement, want to trigger smart contract logic post-payment, or must reconcile on-chain state with their accounting systems, this opacity is a critical gap.

> **Why This Matters to Stripe**
>
> Stripe's two largest strategic bets are stablecoins and AI-driven commerce. They acquired Bridge for $1.1B, are co-building the Tempo blockchain, acquired Privy for wallet infrastructure, and launched stablecoin subscription payments. As stablecoin transaction volume quadruples and Stripe processes an increasing share of crypto-native payments, the demand for on-chain transparency will grow exponentially. CryptoVerifyHook solves this problem before Stripe's own product team ships a native solution — demonstrating the exact kind of infrastructure thinking the Crypto sub-team needs.

---

## 1. The Problem Space

### 1.1 How Stripe Stablecoin Payments Work Today

When a customer selects stablecoin payment at checkout, Stripe redirects them to `crypto.stripe.com` where they connect a crypto wallet, select their preferred token (USDC, USDP, or USDG) and network (Ethereum, Solana, Polygon, or Base), and sign the transaction. Stripe's settlement services provider (Bridge) receives the stablecoins into a merchant deposit address, converts them to USD, and settles the funds into the merchant's Stripe balance.

From the merchant's perspective, this is invisible. Stripe fires standard payment webhook events and the stablecoin payment behaves identically to a card payment in the Dashboard. The blockchain is entirely abstracted.

### 1.2 The Five Critical Gaps

#### Gap 1: No On-Chain Settlement Proof

Stripe's `payment_intent.succeeded` event confirms that Stripe considers the payment complete, but provides no blockchain transaction hash, no block number, no confirmation count, and no wallet addresses. For businesses in regulated industries (financial services, real estate, high-value goods), proof of on-chain settlement may be required for compliance and audit trails. Stripe's legal terms explicitly state that the customer's obligation is satisfied when the blockchain records the deposit — but merchants have no way to independently verify this.

#### Gap 2: No Chain-Aware Event Stream

Stripe's webhooks do not distinguish between a USDC payment on Ethereum vs. Solana vs. Base. The chain, token contract address, and network-specific metadata are absent from the Payment Intent object. Developers building multi-chain applications — or needing to route post-payment logic differently per chain — are flying blind.

#### Gap 3: No Real-Time Finality Tracking

Each blockchain has a different finality model. Ethereum requires approximately 12–15 minutes for strong finality after the Merge. Solana achieves near-instant finality via its optimistic confirmation model. Base, as an L2 rollup, has its own finality timeline dependent on L1 batch submissions. Stripe provides a single binary state (succeeded/failed) that collapses these nuances into a lossy abstraction. For high-value transactions where premature confirmation creates risk, this is insufficient.

#### Gap 4: No Reconciliation Between Stripe and On-Chain State

When a Stripe payment intent shows `succeeded` but the on-chain transfer is delayed, reverted, or stuck in the mempool, there is no automated way to detect the discrepancy. Conversely, if an on-chain transfer completes but Stripe's internal processing has a delay, the merchant has no independent confirmation. This dual-ledger divergence creates reconciliation risk that grows with transaction volume.

#### Gap 5: No Programmable Post-Settlement Triggers

After a stablecoin payment settles on-chain, developers may need to trigger downstream actions: update a smart contract, release an NFT, authorize a service, notify a DAO treasury, or log the settlement in an on-chain audit trail. Stripe's abstraction makes this impossible without integrating a separate blockchain monitoring service (Alchemy, QuickNode, Moralis) and manually correlating events — negating the simplicity that drew them to Stripe in the first place.

> **Impact Quantification**
>
> As of February 2026, Stripe reports stablecoin volume quadrupling year-over-year. The top 20 AI companies on Stripe draw 60% of revenue internationally, and companies like Shadeform report 20% of payment volume shifting to stablecoins. With Stripe processing $1.9T+ annually and stablecoin adoption accelerating, even a small fraction of merchants needing on-chain verification represents thousands of businesses and millions of transactions left without tooling.

---

## 2. How CryptoVerifyHook Solves It

### 2.1 Core Design Principle

**Mirror Stripe's patterns, extend with blockchain data.** CryptoVerifyHook doesn't replace Stripe's payment flow. It runs in parallel, independently verifying on-chain settlement and enriching the merchant's event stream with blockchain-native data. Every webhook it emits follows Stripe's signing scheme, retry logic, and payload structure — so developers who know Stripe's webhooks already know how to consume CryptoVerifyHook's events.

### 2.2 What It Does

- **Listens to Stripe webhook events:** Subscribes to `payment_intent.succeeded`, `payment_intent.processing`, and `payment_intent.payment_failed` for crypto-type payment methods.
- **Extracts settlement metadata:** Parses the Payment Intent to identify the expected chain, token, amount, and merchant deposit address (derived from configuration or Stripe Financial Accounts API).
- **Monitors on-chain state:** Connects to blockchain RPCs for each supported chain (Ethereum, Solana, Base, Polygon) and watches for matching ERC-20/SPL Transfer events to the merchant's deposit address.
- **Correlates events:** Matches Stripe Payment Intent IDs to on-chain transactions using amount, timing, and address heuristics. Stores the correlation in a durable mapping.
- **Verifies finality:** Tracks block confirmations per chain's finality model and emits progressive verification events as the transaction moves from pending to soft-confirmed to finalized.
- **Emits normalized webhooks:** Sends chain-enriched webhook events to the merchant's endpoint with Stripe-compatible HMAC-SHA256 signatures, idempotency keys, and exponential backoff retries.
- **Detects discrepancies:** Surfaces mismatches between Stripe's internal state and on-chain reality — amount differences, missing transactions, stuck transfers, chain reorganizations.

### 2.3 Webhook Event Types

CryptoVerifyHook emits the following custom event types, all following Stripe's webhook payload structure:

| Event Type | Description |
|---|---|
| `chain.tx.detected` | Matching on-chain transaction found in the mempool or a recent block. Includes tx hash, chain, token contract, and sender/receiver addresses. |
| `chain.tx.confirming` | Transaction is included in a block and accumulating confirmations. Fired at configurable confirmation thresholds (e.g., 1, 6, 12 for Ethereum). Payload includes current confirmation count and estimated time to finality. |
| `chain.tx.finalized` | Transaction has reached chain-specific finality threshold. This is the definitive proof of settlement. Includes full on-chain receipt data. |
| `chain.tx.failed` | On-chain transaction reverted or was dropped from the mempool. Includes revert reason if available. |
| `chain.reorg.detected` | A chain reorganization invalidated a previously confirmed transaction. Critical for Ethereum and L2s. Triggers re-verification from the new canonical chain. |
| `reconciliation.mismatch` | Discrepancy detected between Stripe's Payment Intent state and on-chain reality. Types: `amount_mismatch`, `missing_transfer`, `timing_anomaly`, `duplicate_transfer`. |

---

## 3. Technical Architecture

### 3.1 System Overview

CryptoVerifyHook is composed of five core services, each with a single responsibility, communicating through an internal event bus (Redis Streams or NATS JetStream for durability). The system is designed for horizontal scalability — each service can be independently scaled based on chain-specific load.

| Service | Responsibility | Key Technical Decisions |
|---|---|---|
| **Stripe Listener** | Ingests Stripe webhook events | Verifies Stripe webhook signatures. Filters for crypto payment method types. Publishes to internal event bus. Implements exactly-once semantics via idempotency keys. |
| **Chain Watcher** | Monitors blockchain state per chain | One instance per chain. Uses WebSocket subscriptions for EVM chains (`eth_subscribe` for pending txs and new heads) and Solana's `onLogs` subscription. Falls back to polling with configurable intervals. Manages RPC connection pooling and failover. |
| **Correlator** | Matches Stripe events to on-chain txs | Consumes events from both Stripe Listener and Chain Watchers. Performs multi-dimensional matching (amount, address, timing window). Stores correlations in PostgreSQL with ACID guarantees. Handles edge cases: partial matches, multiple candidates, late arrivals. |
| **Finality Tracker** | Tracks confirmation progress | Chain-specific finality logic: EVM block confirmations, Solana commitment levels (processed/confirmed/finalized), L2 batch submission verification. Emits progressive confirmation events. Detects chain reorganizations by monitoring uncle/orphan blocks. |
| **Webhook Emitter** | Delivers events to merchants | Generates HMAC-SHA256 signed payloads using Stripe's timestamp+signature scheme. Implements exponential backoff retries (matching Stripe's retry schedule). Provides idempotency guarantees via event IDs. Supports webhook endpoint registration and management API. |

### 3.2 Chain-Specific Finality Models

A core engineering challenge is handling the radically different finality guarantees across Stripe's supported chains. CryptoVerifyHook abstracts these differences behind a unified finality state machine while preserving chain-specific granularity in webhook payloads.

| Chain | Finality Type | Time to Finality | Reorg Risk | Monitoring Strategy |
|---|---|---|---|---|
| **Ethereum** | Proof of Stake, Casper FFG finality | ~12–15 minutes (2 epochs) | Low post-merge, but possible within first epoch | WebSocket `newHeads` + `eth_getTransactionReceipt` polling |
| **Solana** | Optimistic confirmation, Tower BFT | ~400ms (confirmed), ~6–12s (finalized) | Minimal for finalized commitment | `onLogs` subscription with finalized commitment |
| **Base (L2)** | Optimistic rollup, L1 batch finality | ~2s (L2 soft), ~7 days (L1 challenge) | Low for L2 soft confirm; theoretically possible during challenge period | Dual monitoring: L2 block + L1 batch submission tracking |
| **Polygon PoS** | PoS with periodic Ethereum checkpoints | ~2s (block), ~30min (checkpoint) | Possible between checkpoints | WebSocket + checkpoint verification against Ethereum L1 |

### 3.3 Correlation Engine Design

The Correlator is the most architecturally complex component. It must match Stripe Payment Intents to on-chain transactions without a shared identifier — Stripe does not expose the blockchain transaction hash, and the on-chain transfer does not contain the Stripe Payment Intent ID.

**Matching heuristics (applied in order of confidence):**

1. **Exact amount match:** The stablecoin transfer amount (accounting for token decimals: USDC uses 6) matches the Payment Intent amount within a configurable tolerance (default: 0.01 USDC) to account for rounding.
2. **Address match:** The transfer destination matches the merchant's known deposit address (configured per merchant or derived from Stripe Financial Accounts API).
3. **Timing window:** The on-chain transfer falls within a configurable window around the Payment Intent creation time (default: +/- 30 minutes). This window accounts for Stripe's internal processing time and variable blockchain confirmation speeds.
4. **Token contract match:** The ERC-20/SPL Transfer event originates from the correct USDC/USDP/USDG contract address on the expected chain.

> **Edge Case: Multiple Candidate Transactions**
>
> When multiple on-chain transfers match the heuristics (e.g., two identical USDC amounts to the same address within the timing window), the Correlator enters a disambiguation flow. It scores candidates by temporal proximity to the Stripe event, checks for exact decimal precision matches, and flags ambiguous cases for manual review via a `reconciliation.review_required` event. This prevents false-positive correlations that could compromise audit integrity.

### 3.4 Webhook Signature Compatibility

CryptoVerifyHook's webhook signatures follow Stripe's exact signing scheme so that existing Stripe webhook verification libraries work out of the box. The payload header uses the format `t=<timestamp>,v1=<signature>` where the signature is computed as `HMAC-SHA256(webhook_secret, timestamp + "." + payload_body)`. Developers verify CryptoVerifyHook webhooks using the same `stripe.webhooks.constructEvent()` pattern they already use — they just point it at CryptoVerifyHook's signing secret instead.

---

## 4. Technology Stack and Dependencies

### 4.1 Runtime and Language

| Component | Choice | Rationale |
|---|---|---|
| **Language** | TypeScript (Node.js 20+) | Matches Stripe's SDK ecosystem. Best library support for both ethers.js and @solana/web3.js. Type safety critical for financial amounts. |
| **Database** | PostgreSQL 16 | ACID guarantees for correlation mappings. JSONB for flexible chain-specific metadata. Advisory locks for concurrent correlation resolution. |
| **Event Bus** | Redis Streams (or NATS JetStream) | Durable message delivery with consumer groups. At-least-once semantics with idempotency at the consumer level. Low-latency inter-service communication. |
| **Cache** | Redis (shared with event bus) | Idempotency key store, recent transaction cache, rate limit counters, RPC health tracking. |
| **Containerization** | Docker + Docker Compose | Reproducible local development. `docker-compose.yml` includes PostgreSQL, Redis, and all five services. Production-ready with Kubernetes manifests. |

### 4.2 External Dependencies

#### Stripe APIs

- **Payment Intents API:** Read payment state, amount, currency, payment method details for crypto-type payments.
- **Webhooks API:** Subscribe to `payment_intent.succeeded`, `payment_intent.processing`, `payment_intent.payment_failed`, `charge.refunded`.
- **Financial Accounts API:** Derive merchant deposit addresses for stablecoin balances (if using Stripe's Financial Accounts with stablecoin support).
- **Balance Transactions API:** Cross-reference Stripe's internal settlement records for reconciliation.

#### Blockchain Libraries

- **ethers.js v6:** Ethereum, Base, and Polygon RPC interaction. WebSocket provider for real-time event subscriptions. ERC-20 Transfer event log parsing using USDC contract ABI. Block confirmation tracking via `provider.getTransactionReceipt()`.
- **@solana/web3.js:** Solana RPC interaction. `onLogs` subscription for SPL Token Transfer events. Commitment level management (processed, confirmed, finalized). Transaction signature status polling.

#### USDC Contract Addresses (Production)

| Chain | USDC Contract | Token Standard |
|---|---|---|
| Ethereum | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | ERC-20 |
| Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | ERC-20 |
| Polygon | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | ERC-20 |
| Solana | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | SPL Token |

---

## 5. Data Model

The PostgreSQL schema is designed around three core tables that track the lifecycle of a stablecoin payment from Stripe's perspective, the blockchain's perspective, and their correlation.

### 5.1 Core Tables

- **`stripe_payment_events`:** Stores ingested Stripe webhook events for crypto-type payments. Indexed by `payment_intent_id` with a unique constraint on `event_id` for idempotent ingestion. Contains amount, currency, payment method type, and raw event payload as JSONB.
- **`chain_transactions`:** Stores discovered on-chain transactions that match monitoring criteria (correct token contract, correct destination address). Indexed by `chain + tx_hash` (unique). Contains `block_number`, `confirmation_count`, `finality_status` (pending/soft_confirmed/finalized), `sender_address`, `receiver_address`, `token_amount` (stored as NUMERIC for arbitrary precision), and raw transaction receipt as JSONB.
- **`payment_correlations`:** Stores the verified mapping between a Stripe Payment Intent and an on-chain transaction. Foreign keys to both `stripe_payment_events` and `chain_transactions`. Contains `correlation_confidence` (0.0–1.0), `matched_at` timestamp, and discrepancy details as JSONB if any mismatch was detected. Uses a PostgreSQL advisory lock during correlation resolution to prevent race conditions when multiple Chain Watchers find candidate transactions simultaneously.

### 5.2 Webhook Delivery Tables

- **`webhook_endpoints`:** Merchant-registered endpoints with URL, signing secret, active/inactive status, and chain filter configuration (e.g., only receive events for Ethereum transactions).
- **`webhook_deliveries`:** Tracks every delivery attempt per event per endpoint. Contains `delivery_status` (pending/succeeded/failed), HTTP response code, `attempt_count`, `next_retry_at`, and the signed payload that was sent. Enables replay of any delivery for debugging.

---

## 6. Operational Concerns

### 6.1 RPC Reliability and Failover

Blockchain RPC endpoints are the system's most failure-prone dependency. CryptoVerifyHook implements a multi-tier RPC strategy:

1. **Primary RPC:** Dedicated node provider (Alchemy, QuickNode, or Infura) with WebSocket support. Health-checked every 10 seconds via `eth_blockNumber` / `getSlot` calls.
2. **Secondary RPC:** A different provider for redundancy. Automatic failover when primary misses 3 consecutive health checks or returns stale block numbers (>30 seconds behind).
3. **Fallback polling:** If all WebSocket connections fail, the system degrades gracefully to HTTP polling at configurable intervals (default: 2s for Solana, 12s for Ethereum, 2s for Base/Polygon).

### 6.2 Idempotency Guarantees

Every layer of the system is idempotent:

- **Stripe webhook ingestion** uses the event ID as a natural idempotency key. Duplicate events are detected via a unique constraint on `stripe_payment_events.event_id` and silently dropped.
- **Chain transaction ingestion** uses `chain + tx_hash` as a composite unique key. Re-processing the same block produces no duplicates.
- **Correlation resolution** uses PostgreSQL advisory locks keyed to the Payment Intent ID. Only one correlation attempt can run per Payment Intent at a time.
- **Webhook delivery** uses a deterministic event ID derived from the correlation ID + event type + sequence number. Merchants receiving the same event ID twice can safely deduplicate.

### 6.3 Observability

The system exposes Prometheus metrics for each service:

- Stripe events ingested per second (by event type)
- On-chain transactions detected per second (by chain)
- Correlation success/failure rates
- Correlation latency (time from Stripe event to on-chain match)
- Webhook delivery success rate and p99 latency
- RPC health status per chain per provider
- Finality tracker queue depth

A Grafana dashboard template is included in the repository for one-click observability setup.

---

## 7. Interview Talking Points

This section maps CryptoVerifyHook's engineering decisions to the questions and themes likely to arise in a Stripe MaaS / Crypto team interview.

### 7.1 Distributed Systems

- **Why event-driven over request/response?** Blockchain transactions are inherently asynchronous. A payment can take 400ms (Solana) or 15 minutes (Ethereum) to finalize. An event-driven architecture naturally models this temporal uncertainty without holding connections open or implementing complex polling at the API layer.
- **How do you handle exactly-once delivery?** CryptoVerifyHook achieves effectively-once semantics through idempotent consumers. Each service uses natural deduplication keys (Stripe event IDs, chain+tx_hash pairs, advisory locks for correlation) so that at-least-once delivery at the event bus layer produces exactly-once business outcomes.
- **What happens during a chain reorganization?** The Finality Tracker monitors for uncle/orphan blocks on EVM chains. When a reorg is detected that affects a previously-confirmed transaction, it emits a `chain.reorg.detected` event with the old and new transaction status, resets the correlation to a pending state, and re-verifies from the new canonical chain head.

### 7.2 API and Product Design

- **Why mirror Stripe's webhook contract?** Developer experience is the moat. By matching Stripe's signing scheme and payload structure, CryptoVerifyHook has zero learning curve for any developer who has integrated Stripe webhooks. This is a deliberate product decision, not just a technical one — it reduces adoption friction to near zero.
- **How would you evolve this into a Stripe-native feature?** The webhook events could be merged into Stripe's existing event stream as new event types under a `crypto.settlement.*` namespace. The correlation engine would move server-side, with access to Stripe's internal transaction graph (eliminating the heuristic matching). The finality tracker could feed directly into Stripe's payment state machine, enabling a new `confirmed_on_chain` status for Payment Intents.

### 7.3 Financial Infrastructure

- **How do you handle amount precision?** USDC uses 6 decimal places on EVM chains and Solana. All amounts are stored as NUMERIC in PostgreSQL and processed as BigInt/BigNumber in TypeScript to avoid floating-point errors. The correlation engine matches on raw token units (microUSDC) before any human-readable conversion.
- **What's the reconciliation philosophy?** Trust, but verify. CryptoVerifyHook doesn't assume Stripe is wrong or the blockchain is wrong. It surfaces discrepancies with full context (both sides of the mismatch, timestamps, amounts) and lets the merchant's system decide how to act. This mirrors the reconciliation principles behind Stripe's own data pipeline, which requires up to 8 separate reports for complete financial accuracy.

---

## 8. Development Roadmap

### Phase 1: Core MVP (Weeks 1–3)

- Stripe Listener service with webhook signature verification and crypto payment filtering.
- Single-chain Chain Watcher for Base (lowest finality complexity, most active for Stripe's stablecoin subscriptions).
- Basic Correlator with amount + address + timing matching.
- Webhook Emitter with Stripe-compatible signing.
- PostgreSQL schema and Docker Compose development environment.
- Integration test suite using Stripe's test mode + Base Sepolia testnet.

### Phase 2: Multi-Chain (Weeks 4–5)

- Add Ethereum, Solana, and Polygon Chain Watchers.
- Implement chain-specific finality logic in the Finality Tracker.
- Add chain reorganization detection for Ethereum.
- RPC failover and health monitoring.

### Phase 3: Production Hardening (Week 6)

- Prometheus metrics and Grafana dashboard.
- Reconciliation mismatch detection and reporting.
- Webhook delivery retry with exponential backoff.
- Comprehensive README, API documentation, and deployment guide.
- GitHub release with CI/CD pipeline.

---

## 9. Why This Project Wins

CryptoVerifyHook sits at the exact intersection of Stripe's two largest bets: **stablecoin infrastructure** and **developer experience**. It demonstrates the ability to think across two fundamentally different system models (traditional payment processing and blockchain consensus), design reliable infrastructure that bridges them, and deliver it in a developer experience that feels native to the Stripe ecosystem.

For the MaaS Crypto sub-team specifically, this project signals deep understanding of: how Stripe's payment event system works, how stablecoin settlement differs across chains, how to build a correlation engine for financial data without shared identifiers, how to handle the failure modes unique to blockchain infrastructure (reorgs, RPC failures, finality delays), and how to wrap all of that complexity in an API surface so simple that it feels like an extension of Stripe itself.

> **The Signal**
>
> Stripemeter proved you can build metering infrastructure with exactly-once guarantees and invoice parity. CryptoVerifyHook proves you can extend that same rigor across the fiat/crypto boundary — the exact problem the Crypto team is solving as they integrate Bridge, scale Tempo, and bring stablecoin payments to Stripe's 300,000+ Billing customers.

---

*CryptoVerifyHook — Technical Deep Dive v1.0 — March 2026*
