import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  dispatchAction,
  getAction,
  getReceipt,
  listTransitions,
  proposeAction,
  reconcileAction,
  reevaluateAwaitingActions,
  sweepStaleDispatches,
  verifyAction,
} from '../src/modules/actions/index.js';
import { revokeEnvelope, supersedeEnvelopesForGoal } from '../src/modules/authorization/index.js';
import { queuedJobs, resetDatabase, testDatabase } from './helpers/db.js';
import { seedWorld } from './helpers/world.js';

const database = testDatabase();
afterAll(() => database.close());
beforeEach(() => resetDatabase(database));

async function propose(
  w: Awaited<ReturnType<typeof seedWorld>>,
  semanticKey = 'initial-email',
  to?: string[],
) {
  return proposeAction(w.deps, {
    userId: w.user.id,
    goalId: w.goal.id,
    capability: 'email.send',
    input: w.emailInput(to),
    semanticKey,
  });
}

describe('happy path', () => {
  it('sends once under an envelope, records a receipt, and verifies independently', async () => {
    const w = await seedWorld(database);
    const env = await w.authorize();
    const { action } = await propose(w);
    expect(action.status).toBe('authorized');
    expect((await queuedJobs(database)).map((j) => j.task)).toEqual(['action:dispatch']);

    expect(await dispatchAction(w.deps, action.id)).toBe('succeeded');
    expect(await verifyAction(w.deps, action.id)).toBe('verified');

    const final = await getAction(database.db, action.id);
    const receipt = await getReceipt(database.db, action.id);
    expect(final?.status).toBe('verified');
    expect(receipt).toMatchObject({
      goalId: w.goal.id,
      provider: 'fake-email',
      providerRef: 'msg_1',
      contentHash: action.contentHash,
      envelopeId: env.id,
      envelopeVersion: 1,
      permitId: 'initial-email',
      obtainedVia: 'dispatch',
      verificationStatus: 'verified',
    });
    expect(w.email.sendsFor(action.id)).toBe(1);
    expect((await listTransitions(database.db, action.id)).map((t) => t.to)).toEqual([
      'authorized',
      'prepared',
      'dispatching',
      'succeeded',
      'verified',
    ]);
  });
});

describe('no duplicate side effects', () => {
  it('collapses a re-proposal of the same effect onto the existing action', async () => {
    const w = await seedWorld(database);
    await w.authorize();
    const first = await propose(w);
    const again = await propose(w);
    expect(again.created).toBe(false);
    expect(again.conflict).toBe(false);
    expect(again.action.id).toBe(first.action.id);
  });

  it('flags a different payload under the same semantic key instead of creating a second send', async () => {
    const w = await seedWorld(database);
    await w.authorize();
    const first = await propose(w);
    const changed = await proposeAction(w.deps, {
      userId: w.user.id,
      goalId: w.goal.id,
      capability: 'email.send',
      input: { ...w.emailInput(), body: 'different' },
      semanticKey: 'initial-email',
    });
    expect(changed).toMatchObject({ created: false, conflict: true });
    expect(changed.action.id).toBe(first.action.id);
  });

  it('does not re-send when the provider sent but the response was lost', async () => {
    const w = await seedWorld(database);
    await w.authorize();
    const { action } = await propose(w);
    w.email.failures = ['send_then_timeout'];

    expect(await dispatchAction(w.deps, action.id)).toBe('uncertain');
    expect(await reconcileAction(w.deps, action.id)).toBe('found');
    expect(await verifyAction(w.deps, action.id)).toBe('verified');

    expect(w.email.sendsFor(action.id)).toBe(1);
    expect(await getReceipt(database.db, action.id)).toMatchObject({
      obtainedVia: 'reconciliation',
    });
  });

  it('retries only after reconciliation proves nothing was sent', async () => {
    const w = await seedWorld(database);
    await w.authorize();
    const { action } = await propose(w);
    w.email.failures = ['timeout_without_send'];

    expect(await dispatchAction(w.deps, action.id)).toBe('uncertain');
    expect(await reconcileAction(w.deps, action.id)).toBe('not_found_retrying');
    expect(await dispatchAction(w.deps, action.id)).toBe('succeeded');
    expect(w.email.sendsFor(action.id)).toBe(1);
  });

  it('stays uncertain (never guesses) while the provider cannot answer', async () => {
    const w = await seedWorld(database);
    w.deps.limits = { maxReconcileAttempts: 2 };
    await w.authorize();
    const { action } = await propose(w);
    w.email.failures = ['send_then_timeout'];
    w.email.reconcileUnavailable = true;

    await dispatchAction(w.deps, action.id);
    expect(await reconcileAction(w.deps, action.id)).toBe('still_unknown');
    expect(await reconcileAction(w.deps, action.id)).toBe('gave_up');
    expect(await dispatchAction(w.deps, action.id)).toBe('sent_to_reconciliation');
    expect((await getAction(database.db, action.id))?.status).toBe('uncertain');
    expect(w.email.sendsFor(action.id)).toBe(1);
  });

  it('treats a dispatch job re-run after a worker crash as uncertain, not as a fresh send', async () => {
    const w = await seedWorld(database);
    await w.authorize();
    const { action } = await propose(w);
    // Simulate: phase 1 committed `dispatching`, then the process died before the provider call returned.
    await dispatchAction(w.deps, action.id);
    await database.pool.query(`update actions set status = 'dispatching' where id = $1`, [
      action.id,
    ]);
    await database.pool.query(`delete from receipts where action_id = $1`, [action.id]);

    expect(await dispatchAction(w.deps, action.id)).toBe('sent_to_reconciliation');
    expect(await reconcileAction(w.deps, action.id)).toBe('found');
    expect(w.email.sendsFor(action.id)).toBe(1);
  });

  it('sweeps actions orphaned in dispatching into reconciliation', async () => {
    const w = await seedWorld(database);
    await w.authorize();
    const { action } = await propose(w);
    await database.pool.query(`update actions set status = 'dispatching' where id = $1`, [
      action.id,
    ]);
    expect(await sweepStaleDispatches(w.deps)).toBe(0);
    w.clock.advance(6 * 60_000);
    expect(await sweepStaleDispatches(w.deps)).toBe(1);
    expect((await getAction(database.db, action.id))?.status).toBe('uncertain');
  });

  it('retries definite provider rejections with a bounded budget', async () => {
    const w = await seedWorld(database);
    w.deps.limits = { maxDispatchAttempts: 2 };
    await w.authorize();
    const { action } = await propose(w);
    w.email.failures = ['reject_retryable', 'reject_retryable'];
    expect(await dispatchAction(w.deps, action.id)).toBe('failed_retryable');
    expect(await dispatchAction(w.deps, action.id)).toBe('failed_permanent');
    expect(w.email.sent).toHaveLength(0);
  });
});

describe('authority', () => {
  it('waits for authorization, then releases the action when an envelope is approved', async () => {
    const w = await seedWorld(database);
    const { action } = await propose(w);
    expect(action.status).toBe('awaiting_authorization');
    expect(await dispatchAction(w.deps, action.id)).toBe('noop');

    await w.authorize();
    expect(await reevaluateAwaitingActions(w.deps, w.goal.id)).toHaveLength(1);
    expect(await dispatchAction(w.deps, action.id)).toBe('succeeded');
  });

  it('denies an email to someone the goal is not about, whatever the envelope says', async () => {
    const w = await seedWorld(database);
    await w.authorize();
    const { action } = await propose(w, 'injected', ['attacker@evil.com']);
    expect(action).toMatchObject({ status: 'denied', policyReason: 'recipient_not_pinned' });
    expect(await dispatchAction(w.deps, action.id)).toBe('noop');
    expect(w.email.sent).toHaveLength(0);
  });

  it('re-checks policy at dispatch: revoking the envelope stops already-queued work', async () => {
    const w = await seedWorld(database);
    const env = await w.authorize();
    const { action } = await propose(w);
    await database.db.transaction((tx) =>
      revokeEnvelope(tx, w.clock, { envelopeId: env.id, userId: w.user.id }),
    );
    expect(await dispatchAction(w.deps, action.id)).toBe('blocked_by_policy');
    expect((await getAction(database.db, action.id))?.status).toBe('awaiting_authorization');
    expect(w.email.sent).toHaveLength(0);
  });

  it('a material goal change supersedes the envelope and blocks queued work', async () => {
    const w = await seedWorld(database);
    await w.authorize();
    const { action } = await propose(w);
    await database.db.transaction((tx) =>
      supersedeEnvelopesForGoal(tx, w.clock, w.goal.id, 'duration changed'),
    );
    expect(await dispatchAction(w.deps, action.id)).toBe('blocked_by_policy');
  });

  it('enforces permit maxUses at dispatch, under a lock, not just at proposal', async () => {
    const w = await seedWorld(database);
    await w.authorize();
    const a = await propose(w, 'email-a');
    const b = await propose(w, 'email-b');
    // Both were authorized at proposal time (usage was 0 for each)...
    expect([a.action.status, b.action.status]).toEqual(['authorized', 'authorized']);
    // ...but only one can consume the single permit use.
    const outcomes = await Promise.all([
      dispatchAction(w.deps, a.action.id),
      dispatchAction(w.deps, b.action.id),
    ]);
    expect(outcomes.sort()).toEqual(['blocked_by_policy', 'succeeded']);
    expect(w.email.sent).toHaveLength(1);
  });

  it('an expired envelope no longer authorizes', async () => {
    const w = await seedWorld(database);
    await w.authorize();
    const { action } = await propose(w);
    w.clock.advance(8 * 24 * 3600_000);
    expect(await dispatchAction(w.deps, action.id)).toBe('blocked_by_policy');
  });

  it('refuses to dispatch a payload that no longer matches its content hash', async () => {
    const w = await seedWorld(database);
    await w.authorize();
    const { action } = await propose(w);
    await database.pool.query(
      `update actions set input = jsonb_set(input, '{body}', '"tampered"') where id = $1`,
      [action.id],
    );
    expect(await dispatchAction(w.deps, action.id)).toBe('failed_permanent');
    expect(w.email.sent).toHaveLength(0);
  });
});

describe('verification', () => {
  it('marks verification_failed when the provider has no record of the effect', async () => {
    const w = await seedWorld(database);
    await w.authorize();
    const { action } = await propose(w);
    await dispatchAction(w.deps, action.id);
    w.email.verifyMode = 'missing';
    expect(await verifyAction(w.deps, action.id)).toBe('verification_failed');
    expect(await getReceipt(database.db, action.id)).toMatchObject({
      verificationStatus: 'failed',
    });
  });

  it('keeps checking while verification is pending, then gives up with evidence', async () => {
    const w = await seedWorld(database);
    w.deps.limits = { maxVerifyAttempts: 2 };
    await w.authorize();
    const { action } = await propose(w);
    await dispatchAction(w.deps, action.id);
    w.email.verifyMode = 'pending';
    expect(await verifyAction(w.deps, action.id)).toBe('pending');
    expect(await verifyAction(w.deps, action.id)).toBe('verification_failed');
  });
});

describe('audit', () => {
  it('rejects illegal status writes at the database level', async () => {
    const w = await seedWorld(database);
    const { action } = await propose(w);
    await expect(
      database.pool.query(`update actions set status = 'sent' where id = $1`, [action.id]),
    ).rejects.toThrow(/actions_status_check/);
  });

  it('deleting a user removes all of their data', async () => {
    const w = await seedWorld(database);
    await w.authorize();
    const { action } = await propose(w);
    await dispatchAction(w.deps, action.id);
    await database.pool.query(`delete from users where id = $1`, [w.user.id]);
    const { rows } = await database.pool.query(
      `select (select count(*) from actions)::int + (select count(*) from receipts)::int + (select count(*) from goals)::int
            + (select count(*) from entities)::int + (select count(*) from authorization_envelopes)::int as n`,
    );
    expect(rows[0]).toEqual({ n: 0 });
  });
});

describe('non-prod recipient allowlist', () => {
  const ONLY_ME = new Set(['pranav@example.com']);

  it('denies at proposal a pinned, authorized recipient who is not allowlisted', async () => {
    const w = await seedWorld(database);
    await w.authorize();
    const { action } = await proposeAction(
      { ...w.deps, recipientAllowlist: ONLY_ME },
      {
        userId: w.user.id,
        goalId: w.goal.id,
        capability: 'email.send',
        input: w.emailInput(),
        semanticKey: 'initial-email',
      },
    );
    expect(action.status).toBe('denied');
    expect(action.policyReason).toBe('recipient_not_allowlisted');
    expect(await queuedJobs(database)).toEqual([]);
    expect(w.email.sent).toHaveLength(0);
  });

  it('cancels at dispatch an action authorized before the allowlist applied', async () => {
    const w = await seedWorld(database);
    await w.authorize();
    const { action } = await propose(w);
    expect(action.status).toBe('authorized');

    expect(await dispatchAction({ ...w.deps, recipientAllowlist: ONLY_ME }, action.id)).toBe(
      'blocked_by_policy',
    );
    const after = await getAction(database.db, action.id);
    expect(after?.status).toBe('cancelled');
    expect(after?.policyReason).toBe('recipient_not_allowlisted');
    expect(w.email.sent).toHaveLength(0);
  });

  it('sends normally to an allowlisted recipient', async () => {
    const w = await seedWorld(database);
    await w.authorize();
    const deps = { ...w.deps, recipientAllowlist: new Set(['rahul@example.com']) };
    const { action } = await proposeAction(deps, {
      userId: w.user.id,
      goalId: w.goal.id,
      capability: 'email.send',
      input: w.emailInput(),
      semanticKey: 'initial-email',
    });
    expect(action.status).toBe('authorized');
    expect(await dispatchAction(deps, action.id)).toBe('succeeded');
    expect(w.email.sent).toHaveLength(1);
  });
});
