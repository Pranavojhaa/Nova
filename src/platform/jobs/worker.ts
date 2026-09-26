import { run, type Runner, type Task, type TaskList } from 'graphile-worker';
import type { z } from 'zod';
import type pg from 'pg';
import type { Logger } from '../logger.js';
import type { JobDefinition } from './queue.js';

export interface JobHandler<S extends z.ZodType> {
  job: JobDefinition<S>;
  handle(payload: z.output<S>): Promise<void>;
}

export function handler<S extends z.ZodType>(
  job: JobDefinition<S>,
  handle: (payload: z.output<S>) => Promise<void>,
): JobHandler<S> {
  return { job, handle };
}

/** Builds a graphile task list; every payload is schema-validated before a handler sees it. */
export function buildTaskList(handlers: JobHandler<z.ZodType>[], logger: Logger): TaskList {
  const list: TaskList = {};
  for (const h of handlers) {
    const task: Task = async (raw, helpers) => {
      const payload = h.job.payload.parse(raw);
      logger.debug({ job: h.job.name, jobId: helpers.job.id }, 'job start');
      await h.handle(payload);
    };
    list[h.job.name] = task;
  }
  return list;
}

export interface StartWorkerOptions {
  pgPool: pg.Pool;
  handlers: JobHandler<z.ZodType>[];
  logger: Logger;
  concurrency?: number;
  crontab?: string;
}

export function startWorker(opts: StartWorkerOptions): Promise<Runner> {
  return run({
    pgPool: opts.pgPool,
    concurrency: opts.concurrency ?? 5,
    noHandleSignals: false,
    pollInterval: 1000,
    taskList: buildTaskList(opts.handlers, opts.logger),
    ...(opts.crontab === undefined ? {} : { crontab: opts.crontab }),
  });
}
