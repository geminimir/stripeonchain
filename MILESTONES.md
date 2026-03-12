# CryptoVerifyHook — Milestones & Issues

Phased delivery plan. Each milestone maps to a set of GitHub issues.

---

## Milestone 1: Project Scaffolding

Set up the monorepo structure, tooling, CI, Docker environment, and database schema so all subsequent work has a stable foundation.

| # | Issue | Labels |
|---|-------|--------|
| 1 | Initialize TypeScript monorepo with shared config (tsconfig, eslint, prettier) | infra |
| 2 | Add Docker Compose: PostgreSQL 16, Redis, service stubs | infra |
| 3 | Design and implement PostgreSQL schema (stripe_payment_events, chain_transactions, payment_correlations, webhook_endpoints, webhook_deliveries) | database |
| 4 | Add database migration tooling (node-pg-migrate) and seed scripts | database, infra |
| 5 | Set up GitHub Actions CI: lint, type-check, test | infra |

---

## Milestone 2: Stripe Listener

Ingest Stripe webhooks, verify signatures, filter for crypto payment methods, and publish events to the internal bus.

| # | Issue | Labels |
|---|-------|--------|
| 6 | Implement Stripe webhook signature verification endpoint | feature, stripe |
| 7 | Filter and parse crypto-type payment_intent events | feature, stripe |
| 8 | Publish parsed events to Redis Streams with idempotent ingestion | feature, event-bus |
| 9 | Add integration tests: Stripe Listener with mocked Stripe payloads | test |

---

## Milestone 3: Chain Watcher — Base (Single-Chain MVP)

Monitor Base (L2) for ERC-20 Transfer events to merchant deposit addresses. Base is first because it has the simplest finality model and is the most active chain for Stripe stablecoin subscriptions.

| # | Issue | Labels |
|---|-------|--------|
| 10 | Implement Base Chain Watcher: WebSocket subscription to Transfer events on USDC contract | feature, chain-watcher |
| 11 | Add HTTP polling fallback when WebSocket connection fails | feature, chain-watcher |
| 12 | Publish discovered transactions to Redis Streams | feature, event-bus |
| 13 | Add RPC health-check and connection management | feature, reliability |
| 14 | Add integration tests: Chain Watcher with Base Sepolia testnet | test |

---

## Milestone 4: Correlator

Match Stripe Payment Intents to on-chain transactions using amount, address, timing, and token contract heuristics.

| # | Issue | Labels |
|---|-------|--------|
| 15 | Implement correlation engine: consume Stripe + chain events and perform multi-dimensional matching | feature, correlator |
| 16 | Store correlations in PostgreSQL with advisory lock for concurrent resolution | feature, database |
| 17 | Handle edge cases: multiple candidates, partial matches, late arrivals | feature, correlator |
| 18 | Emit reconciliation.mismatch events for discrepancies (amount_mismatch, missing_transfer, timing_anomaly, duplicate_transfer) | feature, correlator |
| 19 | Add unit and integration tests for correlation logic and edge cases | test |

---

## Milestone 5: Finality Tracker

Track block confirmations per chain's finality model. Emit progressive verification events as transactions move from pending to finalized.

| # | Issue | Labels |
|---|-------|--------|
| 20 | Implement finality state machine (pending → soft_confirmed → finalized) | feature, finality |
| 21 | Add Base-specific finality logic: L2 soft confirmation tracking | feature, finality |
| 22 | Emit chain.tx.detected, chain.tx.confirming, chain.tx.finalized, chain.tx.failed events | feature, finality |
| 23 | Add unit tests for finality state transitions | test |

---

## Milestone 6: Webhook Emitter

Deliver chain-enriched events to merchant endpoints using Stripe-compatible HMAC-SHA256 signatures, idempotency keys, and exponential backoff retries.

| # | Issue | Labels |
|---|-------|--------|
| 24 | Implement webhook endpoint registration and management API | feature, webhook |
| 25 | Generate HMAC-SHA256 signed payloads (Stripe t=timestamp,v1=signature format) | feature, webhook |
| 26 | Implement exponential backoff retry with delivery tracking | feature, webhook, reliability |
| 27 | Add idempotency guarantees via deterministic event IDs | feature, webhook |
| 28 | Add integration tests: signature verification with Stripe SDK, retry behavior | test |

---

## Milestone 7: Multi-Chain Expansion

Extend Chain Watcher and Finality Tracker to Ethereum, Solana, and Polygon.

| # | Issue | Labels |
|---|-------|--------|
| 29 | Add Ethereum Chain Watcher with WebSocket newHeads + Transfer log subscriptions | feature, chain-watcher |
| 30 | Add Ethereum finality logic: Casper FFG epoch tracking | feature, finality |
| 31 | Add chain reorganization detection for Ethereum (uncle/orphan block monitoring) and chain.reorg.detected event | feature, finality |
| 32 | Add Solana Chain Watcher with onLogs subscription for SPL Token transfers | feature, chain-watcher |
| 33 | Add Solana finality logic: commitment level tracking (processed → confirmed → finalized) | feature, finality |
| 34 | Add Polygon Chain Watcher with WebSocket + checkpoint verification against Ethereum L1 | feature, chain-watcher |
| 35 | Add multi-tier RPC failover: primary, secondary, fallback polling per chain | feature, reliability |
| 36 | Add integration tests for each new chain watcher | test |

---

## Milestone 8: Production Hardening

Observability, documentation, and final polish for a production-quality release.

| # | Issue | Labels |
|---|-------|--------|
| 37 | Add Prometheus metrics for all five services (ingestion rate, correlation latency, delivery success, RPC health) | feature, observability |
| 38 | Create Grafana dashboard template | feature, observability |
| 39 | Write comprehensive README with architecture diagram, quickstart, and configuration reference | docs |
| 40 | Write API documentation for webhook endpoint management and event schemas | docs |
| 41 | Add end-to-end test: Stripe test mode → Base Sepolia → full pipeline → webhook delivery | test |

---

*CryptoVerifyHook — Milestones & Issues — v1.0 — March 2026*
