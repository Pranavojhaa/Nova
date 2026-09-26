import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runOnce } from 'graphile-worker';
import { actionJobHandlers, getAction, proposeAction } from '../src/modules/actions/index.js';
import { buildTaskList } from '../src/platform/jobs/worker.js';
import { createLogger } from '../src/platform/logger.js';
import { resetDatabase, testDatabase } from './helpers/db.js';
import { seedWorld } from './helpers/world.js';

const database = testDatabase();
afterAll(() => database.close());
beforeEach(() => resetDatabase(database));

describe('worker wiring', () => {
  it('drives an action from proposal to verified purely through queued jobs', async () => {
    const w = await seedWorld(database);
    await w.authorize();
    const { action } = await proposeAction(w.deps, {
      userId: w.user.id,
      goalId: w.goal.id,
      capability: 'email.send',
      input: w.emailInput(),
      semanticKey: 'initial-email',
    });
    const taskList = buildTaskList(actionJobHandlers(w.deps), createLogger('silent'));

    // dispatch job -> enqueues verify job -> verify job
    await runOnce({ pgPool: database.pool, taskList });
    await runOnce({ pgPool: database.pool, taskList });

    expect((await getAction(database.db, action.id))?.status).toBe('verified');
    expect(w.email.sent).toHaveLength(1);
  });
});
