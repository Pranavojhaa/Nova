import { describe, expect, it } from 'vitest';
import {
  ALL_TRANSITIONS,
  canTransitionAction,
  PERMIT_CONSUMING,
  type ActionStatus,
} from './state.js';

describe('action state machine', () => {
  it('never allows a second dispatch without passing through reconciliation', () => {
    // Every path out of `dispatching` that can lead back to `dispatching` must go through `reconciling`
    // or be a definite not-performed failure recorded by dispatch itself.
    const reachable = (from: ActionStatus, avoid: ActionStatus): Set<ActionStatus> => {
      const seen = new Set<ActionStatus>();
      const stack = [...ALL_TRANSITIONS[from]];
      while (stack.length) {
        const s = stack.pop() as ActionStatus;
        if (seen.has(s) || s === avoid) continue;
        seen.add(s);
        stack.push(...ALL_TRANSITIONS[s]);
      }
      return seen;
    };
    expect(reachable('uncertain', 'reconciling').has('dispatching')).toBe(false);
  });

  it('keeps uncertain actions on the reconciliation path only', () => {
    expect(ALL_TRANSITIONS.uncertain).toEqual(['reconciling']);
  });

  it('has terminal states with no exits', () => {
    for (const s of [
      'verified',
      'verification_failed',
      'failed_permanent',
      'denied',
      'cancelled',
    ] as const) {
      expect(ALL_TRANSITIONS[s]).toEqual([]);
    }
  });

  it('rejects skipping prepare', () => {
    expect(canTransitionAction('authorized', 'dispatching')).toBe(false);
    expect(canTransitionAction('authorized', 'prepared')).toBe(true);
  });

  it('counts only prepared-or-later actions against a permit', () => {
    expect(PERMIT_CONSUMING).not.toContain('authorized');
    expect(PERMIT_CONSUMING).not.toContain('awaiting_authorization');
    expect(PERMIT_CONSUMING).toContain('uncertain');
  });
});
