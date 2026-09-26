/**
 * Goal Agenda: runs one turn of a goal when it is triggered.
 *
 *   trigger -> lock goal -> ContextEngine.build -> Reasoner.decide -> policy -> actions / wait / ask / complete
 *
 * Interface only in M0; the loop is built in M2. Turns for one goal are serialized with
 * job key `goal:<id>` so two triggers never run concurrent turns on the same goal.
 */
import type { ContextPacket } from '../context/index.js';
import type { ReasonerDecision } from '../reasoner/index.js';

export interface TurnOutcome {
  goalRunId: string;
  decision: ReasonerDecision;
}

export interface GoalAgenda {
  advance(goalId: string, triggerEventId: string | null): Promise<TurnOutcome>;
}

export type { ContextPacket };
