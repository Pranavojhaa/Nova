import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  activeEnvelopeForGoal,
  approveEnvelope,
  AuthorizationError,
  getEnvelope,
  proposeEnvelope,
  rejectEnvelope,
  revokeEnvelope,
} from '../src/modules/authorization/index.js';
import { resetDatabase, testDatabase } from './helpers/db.js';
import { seedWorld } from './helpers/world.js';

const database = testDatabase();
afterAll(() => database.close());
beforeEach(() => resetDatabase(database));

describe('authorization envelopes', () => {
  it('versions envelopes per goal and keeps exactly one active', async () => {
    const w = await seedWorld(database);
    const v1 = await w.authorize();
    const v2 = await w.authorize(w.terms({ maxUses: 2 }));
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect((await getEnvelope(database.db, v1.id))?.status).toBe('superseded');
    expect((await activeEnvelopeForGoal(database.db, w.goal.id))?.id).toBe(v2.id);
  });

  it('binds approval to the exact terms the user saw', async () => {
    const w = await seedWorld(database);
    const env = await proposeEnvelope(database.db, w.clock, {
      goalId: w.goal.id,
      summary: 's',
      terms: w.terms(),
    });
    await expect(
      database.db.transaction((tx) =>
        approveEnvelope(tx, w.clock, {
          envelopeId: env.id,
          userId: w.user.id,
          termsHash: 'sha256:stale',
        }),
      ),
    ).rejects.toThrow(/terms changed/);
  });

  it('refuses to approve an older version once a newer one was proposed', async () => {
    const w = await seedWorld(database);
    const v1 = await proposeEnvelope(database.db, w.clock, {
      goalId: w.goal.id,
      summary: 's',
      terms: w.terms(),
    });
    await proposeEnvelope(database.db, w.clock, {
      goalId: w.goal.id,
      summary: 's',
      terms: w.terms({ maxUses: 2 }),
    });
    await expect(
      database.db.transaction((tx) =>
        approveEnvelope(tx, w.clock, {
          envelopeId: v1.id,
          userId: w.user.id,
          termsHash: v1.termsHash,
        }),
      ),
    ).rejects.toThrow(/newer version/);
  });

  it('only lets the goal owner decide', async () => {
    const w = await seedWorld(database);
    const env = await proposeEnvelope(database.db, w.clock, {
      goalId: w.goal.id,
      summary: 's',
      terms: w.terms(),
    });
    await expect(
      database.db.transaction((tx) =>
        approveEnvelope(tx, w.clock, {
          envelopeId: env.id,
          userId: '00000000-0000-7000-8000-000000000000',
          termsHash: env.termsHash,
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('cannot pin a recipient that is not a known address of a goal participant', async () => {
    const w = await seedWorld(database);
    const terms = w.terms({ recipients: [{ entityId: w.rahul.id, address: 'attacker@evil.com' }] });
    await expect(
      proposeEnvelope(database.db, w.clock, { goalId: w.goal.id, summary: 's', terms }),
    ).rejects.toThrow(/not a known address/);
  });

  it('supports reject and revoke, and a rejected envelope cannot be approved later', async () => {
    const w = await seedWorld(database);
    const env = await proposeEnvelope(database.db, w.clock, {
      goalId: w.goal.id,
      summary: 's',
      terms: w.terms(),
    });
    await database.db.transaction((tx) =>
      rejectEnvelope(tx, w.clock, { envelopeId: env.id, userId: w.user.id }),
    );
    await expect(
      database.db.transaction((tx) =>
        approveEnvelope(tx, w.clock, {
          envelopeId: env.id,
          userId: w.user.id,
          termsHash: env.termsHash,
        }),
      ),
    ).rejects.toThrow(/rejected/);

    const active = await w.authorize();
    await database.db.transaction((tx) =>
      revokeEnvelope(tx, w.clock, { envelopeId: active.id, userId: w.user.id }),
    );
    expect(await activeEnvelopeForGoal(database.db, w.goal.id)).toBeUndefined();
  });

  it('rejects envelopes that are already expired', async () => {
    const w = await seedWorld(database);
    const terms = { ...w.terms(), expiresAt: '2026-09-01T00:00:00Z' };
    await expect(
      proposeEnvelope(database.db, w.clock, { goalId: w.goal.id, summary: 's', terms }),
    ).rejects.toThrow(/expired/);
  });
});
