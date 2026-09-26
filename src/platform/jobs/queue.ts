import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { DbOrTx } from '../db/client.js';

/**
 * A job definition: a name, a payload schema, and nothing else. Handlers live with the
 * module that owns the work and are registered in the worker entrypoint.
 */
export interface JobDefinition<S extends z.ZodType> {
  name: string;
  payload: S;
}

/** graphile-worker task identifiers: letters, digits, `_`, `-`, `:` (no dots). */
const JOB_NAME = /^[_a-zA-Z][_a-zA-Z0-9:_-]*$/;

export function defineJob<S extends z.ZodType>(name: string, payload: S): JobDefinition<S> {
  if (!JOB_NAME.test(name)) throw new Error(`invalid job name ${name}`);
  return { name, payload };
}

export interface EnqueueOptions {
  /** Deduplicates pending jobs: a second enqueue with the same key replaces the first. */
  jobKey?: string;
  runAt?: Date;
  maxAttempts?: number;
}

/**
 * Enqueues a job *inside the caller's transaction* via graphile-worker's SQL API.
 * This is the outbox guarantee: a state change and the job that follows from it commit
 * together or not at all. Never enqueue side-effecting work outside the state transaction.
 */
export async function enqueue<S extends z.ZodType>(
  tx: DbOrTx,
  job: JobDefinition<S>,
  payload: z.input<S>,
  opts: EnqueueOptions = {},
): Promise<void> {
  const parsed = job.payload.parse(payload);
  await tx.execute(sql`
    select graphile_worker.add_job(
      identifier := ${job.name},
      payload := ${JSON.stringify(parsed)}::json,
      run_at := ${opts.runAt?.toISOString() ?? null}::timestamptz,
      max_attempts := ${opts.maxAttempts ?? 25}::int,
      job_key := ${opts.jobKey ?? null}::text
    )`);
}
