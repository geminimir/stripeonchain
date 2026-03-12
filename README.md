# StripeOnChain

**Unified on-chain settlement verification for Stripe stablecoin payments.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub Issues](https://img.shields.io/github/issues/geminimir/stripeonchain)](https://github.com/geminimir/stripeonchain/issues)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

## The Problem

When a customer pays with USDC through Stripe, the merchant gets a `payment_intent.succeeded` event — but **zero visibility** into the blockchain side. No transaction hash, no block confirmations, no chain identifier, no finality status.

StripeOnChain runs alongside Stripe and independently verifies on-chain settlement, then delivers chain-enriched webhook events that follow Stripe's exact signing scheme. If you know Stripe webhooks, you already know how to use StripeOnChain.

## How It Works

```
┌─────────────┐     ┌──────────────────────────────────────────────────┐     ┌──────────────┐
│             │     │               StripeOnChain                      │     │              │
│   Stripe    │────▶│  Stripe     Chain       Correlator               │     │   Merchant   │
│  Webhooks   │     │  Listener   Watchers    ──────────▶              │────▶│   Backend    │
│             │     │     │       (per chain)  Finality   Webhook      │     │              │
└─────────────┘     │     ▼           │        Tracker    Emitter      │     └──────────────┘
                    │   Redis Streams ◀┘          │          │         │
┌─────────────┐     │     ▲                       ▼          │         │
│  Ethereum   │     │     └───────────────── PostgreSQL ◀────┘         │
│  Solana     │◀───▶│                                                  │
│  Base       │     │                                                  │
│  Polygon    │     └──────────────────────────────────────────────────┘
└─────────────┘
```

1. **Stripe Listener** ingests Stripe webhooks, verifies signatures, and filters for crypto payment methods.
2. **Chain Watchers** (one per chain) monitor ERC-20/SPL Transfer events on USDC contracts via WebSocket subscriptions.
3. **Correlator** matches Stripe Payment Intents to on-chain transactions using amount, address, timing, and token contract heuristics.
4. **Finality Tracker** tracks block confirmations per chain's finality model and progresses transactions through `pending → soft_confirmed → finalized`.
5. **Webhook Emitter** delivers HMAC-SHA256 signed events to merchant endpoints with Stripe-compatible signatures and exponential backoff retries.

## Webhook Events

| Event | Description |
|---|---|
| `chain.tx.detected` | Matching on-chain transaction found. Includes tx hash, chain, token contract, addresses. |
| `chain.tx.confirming` | Transaction accumulating confirmations. Fired at configurable thresholds. |
| `chain.tx.finalized` | Transaction reached chain-specific finality. Definitive proof of settlement. |
| `chain.tx.failed` | Transaction reverted or dropped from mempool. |
| `chain.reorg.detected` | Chain reorganization invalidated a previously confirmed transaction. |
| `reconciliation.mismatch` | Discrepancy between Stripe state and on-chain reality. |

## Tech Stack

| Component | Technology |
|---|---|
| Language | TypeScript (Node.js 20+) |
| Database | PostgreSQL 16 |
| Event Bus | Redis Streams |
| EVM Chains | ethers.js v6 |
| Solana | @solana/web3.js |
| Containers | Docker + Docker Compose |

## Supported Chains

| Chain | USDC Contract | Finality Model |
|---|---|---|
| Ethereum | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | Casper FFG (~12-15 min) |
| Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | L2 optimistic rollup (~2s soft) |
| Polygon | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | PoS + L1 checkpoints (~30 min) |
| Solana | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | Tower BFT (~6-12s finalized) |

## Getting Started

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- A Stripe account with [stablecoin payments](https://docs.stripe.com/crypto/pay-with-crypto) enabled (test mode works)
- RPC endpoints for the chains you want to monitor (e.g. [Alchemy](https://www.alchemy.com/), [QuickNode](https://www.quicknode.com/))

### Quick Start

```bash
# Clone the repo
git clone https://github.com/geminimir/stripeonchain.git
cd stripeonchain

# Copy environment config
cp .env.example .env
# Edit .env with your Stripe keys and RPC URLs

# Start all services
docker compose up

# Register a webhook endpoint
curl -X POST http://localhost:3000/api/webhook-endpoints \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-server.com/webhooks/chain", "chains": ["base", "ethereum"]}'
```

### Verify Webhooks

StripeOnChain signs payloads using Stripe's exact scheme. Verify them with the same code you use for Stripe:

```typescript
import Stripe from 'stripe';

const event = stripe.webhooks.constructEvent(
  body,
  headers['stripe-signature'],
  process.env.STRIPEONCHAIN_WEBHOOK_SECRET
);

switch (event.type) {
  case 'chain.tx.finalized':
    // On-chain settlement confirmed
    const { tx_hash, chain, block_number, confirmations } = event.data;
    break;
  case 'reconciliation.mismatch':
    // Stripe/chain discrepancy detected
    break;
}
```

## Project Status

StripeOnChain is under active development. See [MILESTONES.md](MILESTONES.md) for the full roadmap.

| Milestone | Status |
|---|---|
| M1: Project Scaffolding | In Progress |
| M2: Stripe Listener | Planned |
| M3: Chain Watcher — Base | Planned |
| M4: Correlator | Planned |
| M5: Finality Tracker | Planned |
| M6: Webhook Emitter | Planned |
| M7: Multi-Chain Expansion | Planned |
| M8: Production Hardening | Planned |

## Contributing

We welcome contributions of all kinds. Check out [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

Good first issues are labeled [`good first issue`](https://github.com/geminimir/stripeonchain/labels/good%20first%20issue) on the issue tracker.

## License

MIT — see [LICENSE](LICENSE).
