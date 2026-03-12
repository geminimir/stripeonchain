import express, { Request, Response } from 'express';
import Stripe from 'stripe';

export interface WebhookAppOptions {
  stripeSecretKey: string;
  stripeWebhookSecret: string;
}

export function createWebhookApp(options: WebhookAppOptions): express.Express {
  const { stripeSecretKey, stripeWebhookSecret } = options;

  const stripe = new Stripe(stripeSecretKey);
  const app = express();

  app.post(
    '/webhooks/stripe',
    express.raw({ type: 'application/json' }),
    (req: Request, res: Response): void => {
      const signature = req.headers['stripe-signature'];

      if (!signature) {
        res.status(400).json({ error: 'Missing stripe-signature header' });
        return;
      }

      try {
        const event = stripe.webhooks.constructEvent(
          req.body as Buffer,
          signature as string,
          stripeWebhookSecret,
        );

        res.status(200).json({ received: true, type: event.type });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(400).json({ error: `Webhook signature verification failed: ${message}` });
      }
    },
  );

  return app;
}
