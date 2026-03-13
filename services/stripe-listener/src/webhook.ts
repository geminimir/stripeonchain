import express, { Request, Response } from 'express';
import Stripe from 'stripe';
import { EventStore } from './event-store';
import { processStripeEvent } from './event-processor';

export interface WebhookAppOptions {
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  eventStore?: EventStore;
}

export function createWebhookApp(options: WebhookAppOptions): express.Express {
  const { stripeSecretKey, stripeWebhookSecret, eventStore } = options;

  const stripe = new Stripe(stripeSecretKey);
  const app = express();

  app.post(
    '/webhooks/stripe',
    express.raw({ type: 'application/json' }),
    async (req: Request, res: Response): Promise<void> => {
      const signature = req.headers['stripe-signature'];

      if (!signature) {
        res.status(400).json({ error: 'Missing stripe-signature header' });
        return;
      }

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          req.body as Buffer,
          signature as string,
          stripeWebhookSecret,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(400).json({ error: `Webhook signature verification failed: ${message}` });
        return;
      }

      if (eventStore) {
        const result = await processStripeEvent(event, eventStore);
        res.status(200).json({ received: true, type: event.type, ...result });
      } else {
        res.status(200).json({ received: true, type: event.type });
      }
    },
  );

  return app;
}
