# Contributing to CryptoVerifyHook

Thanks for your interest in contributing. This guide will get you from zero to a merged PR.

---

## Finding Something to Work On

1. Browse [open issues](https://github.com/geminimir/stripeonchain/issues) — they're organized by milestone and labeled by area.
2. Look for issues labeled [`good first issue`](https://github.com/geminimir/stripeonchain/labels/good%20first%20issue) if this is your first contribution.
3. Check the [MILESTONES.md](MILESTONES.md) file for the big picture and current priorities.
4. Comment on the issue you want to work on so others know it's taken.

### Issue Labels

| Label | Area |
|---|---|
| `infra` | Repo tooling, Docker, CI |
| `database` | Schema, migrations |
| `feature` | New functionality |
| `test` | Tests |
| `stripe` | Stripe integration |
| `event-bus` | Redis Streams |
| `chain-watcher` | Blockchain monitoring |
| `correlator` | Correlation engine |
| `finality` | Finality tracking |
| `webhook` | Webhook delivery |
| `reliability` | Failover, retries |
| `observability` | Metrics, dashboards |
| `docs` | Documentation |

---

## Development Setup

### Prerequisites

- **Node.js 20+** — we recommend [nvm](https://github.com/nvm-sh/nvm)
- **Docker and Docker Compose** — for PostgreSQL, Redis, and service containers
- **Git** — obviously

### Clone and Install

```bash
git clone https://github.com/geminimir/stripeonchain.git
cd stripeonchain
npm install
```

### Start the Dev Environment

```bash
cp .env.example .env
docker compose up -d postgres redis
npm run dev
```

### Run Tests

```bash
npm test              # all tests
npm run test:unit     # unit tests only
npm run test:int      # integration tests (requires Docker services)
```

### Lint and Type-Check

```bash
npm run lint          # eslint
npm run typecheck     # tsc --noEmit
```

---

## Making Changes

### Branch Naming

Create a branch from `main` with a descriptive name:

```
feat/stripe-listener-signature-verification
fix/correlator-timing-window
test/webhook-emitter-retry
docs/api-event-schemas
```

Format: `<type>/<short-description>`

Types: `feat`, `fix`, `test`, `docs`, `infra`, `refactor`

### Commit Messages

Write clear, concise commit messages. Use present tense, imperative mood.

```
Add Stripe webhook signature verification endpoint
Fix timing window calculation in correlator
Add unit tests for finality state machine
```

Avoid vague messages like "fix stuff" or "update code".

### Code Style

- TypeScript strict mode is enabled — no `any` without justification.
- All financial amounts use `BigInt` or PostgreSQL `NUMERIC` — never floating point.
- Comments explain *why*, not *what*. Don't narrate obvious code.
- Error handling is explicit — no silent swallows.

---

## Submitting a Pull Request

1. **Push your branch** to your fork or the repo.
2. **Open a PR** against `main` with:
   - A clear title that describes the change
   - A summary of what changed and why
   - Reference to the issue it closes (e.g. `Closes #14`)
   - What tests you ran and their results
3. **Ensure CI passes** — lint, type-check, and tests must all be green.
4. **Respond to review feedback** — maintainers may request changes.

### PR Template

```markdown
## Summary
What changed and why.

## Changes
- Bullet list of key changes

## Tests
- What tests were added or run
- Results

## Related Issues
Closes #XX
```

---

## Reporting Bugs

Open an issue using the [task template](https://github.com/geminimir/stripeonchain/issues/new/choose) with:

- A clear description of the bug
- Steps to reproduce
- Expected vs. actual behavior
- Environment details (OS, Node version, Docker version)

---

## Code of Conduct

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

---

## Questions?

Open a [discussion](https://github.com/geminimir/stripeonchain/issues) or comment on a relevant issue. We're happy to help.
