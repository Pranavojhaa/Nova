import { handler, type JobHandler } from '../../platform/jobs/worker.js';
import type { z } from 'zod';
import { dispatchActionJob, reconcileActionJob, sweepActionsJob, verifyActionJob } from './jobs.js';
import {
  dispatchAction,
  reconcileAction,
  sweepStaleDispatches,
  verifyAction,
  type ActionDeps,
} from './service.js';

export * from './service.js';
export {
  canTransitionAction,
  isTerminalActionStatus,
  ALL_TRANSITIONS,
  PERMIT_CONSUMING,
  type ActionStatus,
} from './state.js';
export { dispatchActionJob, reconcileActionJob, verifyActionJob, sweepActionsJob } from './jobs.js';

export function actionJobHandlers(deps: ActionDeps): JobHandler<z.ZodType>[] {
  return [
    handler(dispatchActionJob, async ({ actionId }) => {
      await dispatchAction(deps, actionId);
    }),
    handler(reconcileActionJob, async ({ actionId }) => {
      await reconcileAction(deps, actionId);
    }),
    handler(verifyActionJob, async ({ actionId }) => {
      await verifyAction(deps, actionId);
    }),
    handler(sweepActionsJob, async () => {
      await sweepStaleDispatches(deps);
    }),
  ] as JobHandler<z.ZodType>[];
}

/** graphile-worker crontab line for the stale-dispatch sweeper. */
export const ACTION_CRONTAB = '* * * * * action:sweep';
