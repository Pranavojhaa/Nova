/**
 * Reasoner: interprets and proposes. It returns data and can cause no side effects
 * (enforced by dependency-cruiser). Interface only in M0; the Claude-backed implementation
 * lands in M2 with strict output schemas.
 */
import type { ContextPacket } from '../context/index.js';

export interface ProposedAction {
  capability: string;
  input: unknown;
  /** Names the effect for idempotency, e.g. 'initial-proposal-email'. Same key = same effect. */
  semanticKey: string;
  taskId?: string;
}

export type ReasonerNext =
  | { kind: 'act'; actions: ProposedAction[] }
  | { kind: 'request_authorization'; summary: string; terms: unknown }
  | { kind: 'wait'; expectation: { matcher: unknown; deadline: string | null } }
  | { kind: 'ask_user'; question: string; options?: string[] }
  | { kind: 'complete'; summary: string }
  | { kind: 'fail'; reason: string };

export interface ReasonerDecision {
  rationale: string;
  taskUpdates: Array<{
    taskId?: string;
    title: string;
    status: 'todo' | 'doing' | 'done' | 'skipped';
  }>;
  next: ReasonerNext;
}

export interface Reasoner {
  decide(context: ContextPacket): Promise<ReasonerDecision>;
}
