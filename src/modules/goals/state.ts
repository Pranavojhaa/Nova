import type { GOAL_STATUSES } from './schema.js';

export type GoalStatus = (typeof GOAL_STATUSES)[number];

const TERMINAL: ReadonlySet<GoalStatus> = new Set(['completed', 'failed', 'cancelled']);

const ALLOWED: Record<GoalStatus, readonly GoalStatus[]> = {
  active: ['waiting', 'awaiting_user', 'completed', 'failed', 'cancelled'],
  waiting: ['active', 'awaiting_user', 'failed', 'cancelled'],
  awaiting_user: ['active', 'cancelled', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function isTerminalGoalStatus(s: GoalStatus): boolean {
  return TERMINAL.has(s);
}

export function canTransitionGoal(from: GoalStatus, to: GoalStatus): boolean {
  return ALLOWED[from].includes(to);
}
