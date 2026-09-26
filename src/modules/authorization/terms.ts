import { z } from 'zod';

export const PermitSchema = z.object({
  /** Stable within an envelope, e.g. 'initial-email', 'book-accepted-slot', 'follow-up'. */
  id: z.string().min(1).max(64),
  capability: z.string().min(1),
  /** Pinned recipients. Every external target of a covered action must be in this list. */
  recipients: z.array(z.object({ entityId: z.uuid(), address: z.email() })),
  maxUses: z.number().int().min(1).max(10),
  /** Capability-specific bounds, checked by Capability.permitAllows. */
  constraints: z.record(z.string(), z.unknown()).default({}),
});

export const EnvelopeTermsSchema = z.object({
  permits: z.array(PermitSchema).min(1),
  expiresAt: z.iso.datetime(),
});

export type Permit = z.infer<typeof PermitSchema>;
export type EnvelopeTerms = z.infer<typeof EnvelopeTermsSchema>;
