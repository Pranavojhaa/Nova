import { z } from 'zod';
import { defineJob } from '../../platform/jobs/queue.js';

const ActionRef = z.object({ actionId: z.uuid() });

export const dispatchActionJob = defineJob('action:dispatch', ActionRef);
export const reconcileActionJob = defineJob('action:reconcile', ActionRef);
export const verifyActionJob = defineJob('action:verify', ActionRef);
export const sweepActionsJob = defineJob('action:sweep', z.looseObject({}));
