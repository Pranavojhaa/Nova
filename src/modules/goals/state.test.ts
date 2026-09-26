import { describe, expect, it } from 'vitest';
import { canTransitionGoal, isTerminalGoalStatus } from './state.js';

describe('goal state machine', () => {
  it('lets a waiting goal wake up and a completed goal stay completed', () => {
    expect(canTransitionGoal('waiting', 'active')).toBe(true);
    expect(canTransitionGoal('completed', 'active')).toBe(false);
    expect(isTerminalGoalStatus('completed')).toBe(true);
  });

  it('only completes from active, never straight from waiting', () => {
    expect(canTransitionGoal('active', 'completed')).toBe(true);
    expect(canTransitionGoal('waiting', 'completed')).toBe(false);
  });
});
