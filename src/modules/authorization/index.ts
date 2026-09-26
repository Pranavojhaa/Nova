import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../platform/db/client.js';
import type { Clock } from '../../platform/clock.js';
import { contentHash } from '../../platform/hashing.js';
import { uuidv7 } from '../../platform/ids.js';
import { emailsForEntities, normalizeEmail } from '../brain/index.js';
import { getGoal, isTerminalGoalStatus, participantEntityIds } from '../goals/index.js';
import { authorizationEnvelopes } from './schema.js';
import { EnvelopeTermsSchema, type EnvelopeTerms } from './terms.js';

export { EnvelopeTermsSchema, PermitSchema, type EnvelopeTerms, type Permit } from './terms.js';

export type EnvelopeRow = typeof authorizationEnvelopes.$inferSelect;
export interface Envelope extends Omit<EnvelopeRow, 'terms'> {
  terms: EnvelopeTerms;
}

export class AuthorizationError extends Error {}

function hydrate(row: EnvelopeRow): Envelope {
  return { ...row, terms: EnvelopeTermsSchema.parse(row.terms) };
}

/**
 * Proposes a new envelope version for a goal. Every pinned recipient must be a goal participant
 * with that exact address in the Brain, so an envelope can never widen who the goal may reach.
 */
export async function proposeEnvelope(
  db: DbOrTx,
  clock: Clock,
  input: { goalId: string; summary: string; terms: EnvelopeTerms },
): Promise<Envelope> {
  const goal = await getGoal(db, input.goalId);
  if (!goal) throw new AuthorizationError('goal not found');
  if (isTerminalGoalStatus(goal.status)) throw new AuthorizationError('goal is closed');

  const terms = EnvelopeTermsSchema.parse({
    ...input.terms,
    permits: input.terms.permits.map((p) => ({
      ...p,
      recipients: p.recipients.map((r) => ({ ...r, address: normalizeEmail(r.address) })),
    })),
  });
  if (new Date(terms.expiresAt) <= clock.now())
    throw new AuthorizationError('envelope already expired');
  const ids = new Set(terms.permits.map((p) => p.id));
  if (ids.size !== terms.permits.length) throw new AuthorizationError('duplicate permit id');

  const participants = await participantEntityIds(db, goal.id);
  const emails = await emailsForEntities(db, participants);
  for (const permit of terms.permits) {
    for (const r of permit.recipients) {
      if (!emails.get(r.entityId)?.includes(r.address)) {
        throw new AuthorizationError(
          `recipient ${r.address} is not a known address of a goal participant`,
        );
      }
    }
  }

  const [row] = await db
    .insert(authorizationEnvelopes)
    .values({
      id: uuidv7(),
      userId: goal.userId,
      goalId: goal.id,
      version: sql`(select coalesce(max(${authorizationEnvelopes.version}), 0) + 1 from ${authorizationEnvelopes} where ${authorizationEnvelopes.goalId} = ${goal.id})`,
      status: 'proposed',
      summary: input.summary,
      terms,
      termsHash: contentHash(terms),
      proposedAt: clock.now(),
    })
    .returning();
  if (!row) throw new Error('insert envelope returned no row');
  return hydrate(row);
}

/**
 * The user approves exactly the terms they saw: the caller passes the hash shown in the UI.
 * Approving supersedes any previously active version for the goal.
 */
export async function approveEnvelope(
  tx: DbOrTx,
  clock: Clock,
  input: { envelopeId: string; userId: string; termsHash: string },
): Promise<Envelope> {
  const [env] = await tx
    .select()
    .from(authorizationEnvelopes)
    .where(eq(authorizationEnvelopes.id, input.envelopeId))
    .for('update');
  if (!env || env.userId !== input.userId) throw new AuthorizationError('envelope not found');
  if (env.status !== 'proposed') throw new AuthorizationError(`envelope is ${env.status}`);
  if (env.termsHash !== input.termsHash)
    throw new AuthorizationError('terms changed since they were shown');
  const latest = await latestVersion(tx, env.goalId);
  if (latest !== env.version)
    throw new AuthorizationError('a newer version of this envelope exists');

  await tx
    .update(authorizationEnvelopes)
    .set({
      status: 'superseded',
      statusReason: `superseded by v${env.version}`,
      decidedAt: clock.now(),
    })
    .where(
      and(
        eq(authorizationEnvelopes.goalId, env.goalId),
        eq(authorizationEnvelopes.status, 'active'),
      ),
    );
  const [row] = await tx
    .update(authorizationEnvelopes)
    .set({ status: 'active', decidedAt: clock.now(), decidedBy: input.userId })
    .where(eq(authorizationEnvelopes.id, env.id))
    .returning();
  if (!row) throw new Error('update envelope returned no row');
  return hydrate(row);
}

export async function rejectEnvelope(
  tx: DbOrTx,
  clock: Clock,
  input: { envelopeId: string; userId: string },
): Promise<void> {
  await decide(tx, clock, input, ['proposed'], 'rejected', 'rejected by user');
}

/** Revocation is immediate: policy re-checks the envelope before every dispatch. */
export async function revokeEnvelope(
  tx: DbOrTx,
  clock: Clock,
  input: { envelopeId: string; userId: string },
): Promise<void> {
  await decide(tx, clock, input, ['proposed', 'active'], 'revoked', 'revoked by user');
}

/**
 * Called whenever a material goal parameter changes (participants, duration, time window).
 * Voids open and active envelopes; Nova must propose a new version and ask again.
 */
export async function supersedeEnvelopesForGoal(
  tx: DbOrTx,
  clock: Clock,
  goalId: string,
  reason: string,
): Promise<number> {
  const rows = await tx
    .update(authorizationEnvelopes)
    .set({ status: 'superseded', statusReason: reason, decidedAt: clock.now() })
    .where(
      and(
        eq(authorizationEnvelopes.goalId, goalId),
        inArray(authorizationEnvelopes.status, ['proposed', 'active']),
      ),
    )
    .returning({ id: authorizationEnvelopes.id });
  return rows.length;
}

/** The active envelope, locked FOR UPDATE when `lock` is set (used when reserving a permit). */
export async function activeEnvelopeForGoal(
  db: DbOrTx,
  goalId: string,
  opts: { lock?: boolean } = {},
): Promise<Envelope | undefined> {
  const q = db
    .select()
    .from(authorizationEnvelopes)
    .where(
      and(eq(authorizationEnvelopes.goalId, goalId), eq(authorizationEnvelopes.status, 'active')),
    );
  const [row] = opts.lock ? await q.for('update') : await q;
  return row ? hydrate(row) : undefined;
}

export async function getEnvelope(db: DbOrTx, id: string): Promise<Envelope | undefined> {
  const [row] = await db
    .select()
    .from(authorizationEnvelopes)
    .where(eq(authorizationEnvelopes.id, id));
  return row ? hydrate(row) : undefined;
}

async function latestVersion(db: DbOrTx, goalId: string): Promise<number> {
  const [row] = await db
    .select({ v: authorizationEnvelopes.version })
    .from(authorizationEnvelopes)
    .where(eq(authorizationEnvelopes.goalId, goalId))
    .orderBy(desc(authorizationEnvelopes.version))
    .limit(1);
  return row?.v ?? 0;
}

async function decide(
  tx: DbOrTx,
  clock: Clock,
  input: { envelopeId: string; userId: string },
  from: Array<EnvelopeRow['status']>,
  to: EnvelopeRow['status'],
  reason: string,
): Promise<void> {
  const rows = await tx
    .update(authorizationEnvelopes)
    .set({ status: to, statusReason: reason, decidedAt: clock.now(), decidedBy: input.userId })
    .where(
      and(
        eq(authorizationEnvelopes.id, input.envelopeId),
        eq(authorizationEnvelopes.userId, input.userId),
        inArray(authorizationEnvelopes.status, from),
      ),
    )
    .returning({ id: authorizationEnvelopes.id });
  if (rows.length === 0) throw new AuthorizationError(`envelope cannot move to ${to}`);
}
