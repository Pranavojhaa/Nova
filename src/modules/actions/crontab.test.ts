import { parseCrontab } from 'graphile-worker';
import { describe, expect, it } from 'vitest';
import { ACTION_CRONTAB, sweepActionsJob } from './index.js';

describe('worker crontab', () => {
  it('parses and schedules the sweeper', () => {
    const [item] = parseCrontab(ACTION_CRONTAB);
    expect(item?.task).toBe(sweepActionsJob.name);
  });
});
