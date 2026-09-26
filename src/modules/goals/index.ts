import { and, asc, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../platform/db/client.js';
import type { Clock } from '../../platform/clock.js';
import { uuidv7 } from '../../platform/ids.js';
import { goalParticipants, goals, tasks, type TASK_STATUSES } from './schema.js';
import { canTransitionGoal, type GoalStatus } from './state.js';

export { canTransitionGoal, isTerminalGoalStatus, type GoalStatus } from './state.js';

export type Goal = typeof goals.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export class GoalTransitionError extends Error {
  constructor(
    readonly from: GoalStatus,
    readonly to: GoalStatus,
  ) {
    super(`illegal goal transition ${from} -> ${to}`);
  }
}

export async function createGoal(
  db: DbOrTx,
  input: {
    userId: string;
    intent: string;
    outcomeSpec: unknown;
    participantEntityIds: string[];
    deadline?: Date;
  },
): Promise<Goal> {
  const id = uuidv7();
  const [row] = await db
    .insert(goals)
    .values({
      id,
      userId: input.userId,
      intent: input.intent,
      outcomeSpec: input.outcomeSpec,
      status: 'active',
      deadline: input.deadline ?? null,
    })
    .returning();
  if (!row) throw new Error('insert goals returned no row');
  if (input.participantEntityIds.length > 0) {
    await db
      .insert(goalParticipants)
      .values(input.participantEntityIds.map((entityId) => ({ goalId: id, entityId })));
  }
  return row;
}

export async function getGoal(db: DbOrTx, id: string): Promise<Goal | undefined> {
  const [row] = await db.select().from(goals).where(eq(goals.id, id));
  return row;
}

export async function participantEntityIds(db: DbOrTx, goalId: string): Promise<string[]> {
  const rows = await db
    .select({ id: goalParticipants.entityId })
    .from(goalParticipants)
    .where(eq(goalParticipants.goalId, goalId));
  return rows.map((r) => r.id);
}

/** Compare-and-set on status so concurrent turns cannot both move a goal. */
export async function transitionGoal(
  db: DbOrTx,
  clock: Clock,
  goalId: string,
  from: GoalStatus,
  to: GoalStatus,
): Promise<Goal> {
  if (!canTransitionGoal(from, to)) throw new GoalTransitionError(from, to);
  const [row] = await db
    .update(goals)
    .set({ status: to, updatedAt: clock.now() })
    .where(and(eq(goals.id, goalId), eq(goals.status, from)))
    .returning();
  if (!row) throw new Error(`goal ${goalId} was not in status ${from}`);
  return row;
}

export async function addTask(db: DbOrTx, goalId: string, title: string): Promise<Task> {
  const [row] = await db
    .insert(tasks)
    .values({
      id: uuidv7(),
      goalId,
      title,
      position: sql`(select coalesce(max(${tasks.position}), -1) + 1 from ${tasks} where ${tasks.goalId} = ${goalId})`,
    })
    .returning();
  if (!row) throw new Error('insert tasks returned no row');
  return row;
}

export async function setTaskStatus(
  db: DbOrTx,
  clock: Clock,
  taskId: string,
  status: TaskStatus,
): Promise<void> {
  await db.update(tasks).set({ status, updatedAt: clock.now() }).where(eq(tasks.id, taskId));
}

export async function listTasks(db: DbOrTx, goalId: string): Promise<Task[]> {
  return db.select().from(tasks).where(eq(tasks.goalId, goalId)).orderBy(asc(tasks.position));
}
