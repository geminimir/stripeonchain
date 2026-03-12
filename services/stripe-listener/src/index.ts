import { REDIS_STREAMS } from '@stripeonchain/shared';
import { createWebhookApp } from './webhook';

const SERVICE_NAME = 'stripe-listener';
const PORT = Number(process.env.STRIPE_LISTENER_PORT) || 3001;

async function main() {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeSecretKey || !stripeWebhookSecret) {
    throw new Error('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set');
  }

  const app = createWebhookApp({ stripeSecretKey, stripeWebhookSecret });

  app.listen(PORT, () => {
    console.info(`[${SERVICE_NAME}] Listening on port ${PORT}`);
    console.info(`[${SERVICE_NAME}] Publishing to ${REDIS_STREAMS.STRIPE_EVENTS}`);
    console.info(`[${SERVICE_NAME}] Ready`);
  });
}

main().catch((err) => {
  console.error(`[${SERVICE_NAME}] Fatal error:`, err);
  process.exit(1);
});
