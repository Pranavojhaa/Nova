/**
 * Connections to external providers. M0 defines storage only; OAuth flows land in M1.
 * Provider adapters (Gmail, Google Calendar) consume a connection through this module and
 * never read token columns directly.
 */
import type { connections } from './schema.js';

export type Connection = typeof connections.$inferSelect;
