import { StripePaymentEvent } from '@stripeonchain/shared';

export type InsertableEvent = Omit<StripePaymentEvent, 'id' | 'created_at' | 'processed_at'>;

export interface EventStore {
  insertEvent(event: InsertableEvent): Promise<void>;
  eventExists(eventId: string): Promise<boolean>;
}
