import { FixedClock } from '../../src/platform/clock.js';
import { createLogger } from '../../src/platform/logger.js';
import type { Database } from '../../src/platform/db/client.js';
import { createUser } from '../../src/modules/identity/index.js';
import { createPerson } from '../../src/modules/brain/index.js';
import { createGoal } from '../../src/modules/goals/index.js';
import {
  approveEnvelope,
  proposeEnvelope,
  type EnvelopeTerms,
} from '../../src/modules/authorization/index.js';
import { CapabilityRegistry } from '../../src/modules/capabilities/index.js';
import type { ActionDeps } from '../../src/modules/actions/index.js';
import { FakeEmail } from '../fakes/fake-email.js';

export const RAHUL = 'rahul@example.com';

/** The meeting-with-Rahul world, minus the reasoning: a user, Rahul, a goal, a fake email provider. */
export async function seedWorld(database: Database) {
  const clock = new FixedClock(new Date('2026-10-01T09:00:00Z'));
  const email = new FakeEmail();
  const deps: ActionDeps = {
    db: database.db,
    clock,
    registry: new CapabilityRegistry([email]),
    logger: createLogger('silent'),
    recipientAllowlist: undefined,
  };
  const user = await createUser(database.db, {
    email: 'pranav@example.com',
    timezone: 'Asia/Kolkata',
  });
  const rahul = await createPerson(database.db, {
    userId: user.id,
    displayName: 'Rahul',
    emails: [RAHUL],
    source: 'test',
  });
  const goal = await createGoal(database.db, {
    userId: user.id,
    intent: 'Coordinate a meeting with Rahul',
    outcomeSpec: { type: 'meeting', durationMinutes: 30 },
    participantEntityIds: [rahul.id],
  });

  const terms = (overrides: Partial<EnvelopeTerms['permits'][number]> = {}): EnvelopeTerms => ({
    expiresAt: '2026-10-08T00:00:00Z',
    permits: [
      {
        id: 'initial-email',
        capability: 'email.send',
        recipients: [{ entityId: rahul.id, address: RAHUL }],
        maxUses: 1,
        constraints: {},
        ...overrides,
      },
    ],
  });

  const authorize = async (t: EnvelopeTerms = terms()) => {
    const env = await proposeEnvelope(database.db, clock, {
      goalId: goal.id,
      summary: 'Email Rahul three times',
      terms: t,
    });
    return database.db.transaction((tx) =>
      approveEnvelope(tx, clock, { envelopeId: env.id, userId: user.id, termsHash: env.termsHash }),
    );
  };

  const emailInput = (to: string[] = [RAHUL]) => ({
    to,
    subject: 'Meeting?',
    body: 'Do Tue 14:00, Wed 11:00 or Thu 16:00 work?',
  });

  return { clock, email, deps, user, rahul, goal, terms, authorize, emailInput };
}
