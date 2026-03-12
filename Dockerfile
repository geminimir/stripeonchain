FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY services/stripe-listener/package.json services/stripe-listener/
COPY services/chain-watcher/package.json services/chain-watcher/
COPY services/correlator/package.json services/correlator/
COPY services/finality-tracker/package.json services/finality-tracker/
COPY services/webhook-emitter/package.json services/webhook-emitter/
RUN npm ci --ignore-scripts

FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY packages/ packages/
COPY services/ services/
RUN npx tsc --build

FROM base AS runner
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/package.json package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/services/stripe-listener/dist services/stripe-listener/dist
COPY --from=build /app/services/stripe-listener/package.json services/stripe-listener/package.json
COPY --from=build /app/services/chain-watcher/dist services/chain-watcher/dist
COPY --from=build /app/services/chain-watcher/package.json services/chain-watcher/package.json
COPY --from=build /app/services/correlator/dist services/correlator/dist
COPY --from=build /app/services/correlator/package.json services/correlator/package.json
COPY --from=build /app/services/finality-tracker/dist services/finality-tracker/dist
COPY --from=build /app/services/finality-tracker/package.json services/finality-tracker/package.json
COPY --from=build /app/services/webhook-emitter/dist services/webhook-emitter/dist
COPY --from=build /app/services/webhook-emitter/package.json services/webhook-emitter/package.json
