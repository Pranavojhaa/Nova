# Architecture (as built)

The full plan and rationale live in `foundation-plan.md` (sections 0-10 are the original plan; section 11 records the approved decisions, and wins where they differ). This page tracks what exists.

## Shape

One TypeScript codebase, two processes: `api` (Fastify) and `worker` (graphile-worker). Postgres is the system of record and the job queue.

## Modules

| Module                      | Owns                                                                       | M0 state                          |
| --------------------------- | -------------------------------------------------------------------------- | --------------------------------- |
| identity                    | users                                                                      | built                             |
| connections                 | provider connections, sealed tokens                                        | schema only                       |
| brain                       | entities, identifiers                                                      | minimal (people + emails)         |
| goals                       | goals, participants, tasks, goal state machine                             | built                             |
| authorization               | versioned envelopes, approval by terms hash                                | built                             |
| policy                      | pure authority decisions                                                   | built                             |
| capabilities                | capability contract + registry                                             | contract built; no real providers |
| actions                     | action ledger, transitions, receipts, dispatch/reconcile/verify/sweep jobs | built                             |
| events                      | events, expectations                                                       | schema + interfaces               |
| agenda / context / reasoner | goal turns                                                                 | interfaces only                   |

## Action lifecycle

```
proposed ──policy──> denied | awaiting_authorization | authorized
authorized ──(final policy check, permit reserved under envelope lock)──> prepared ──> dispatching
dispatching ──> succeeded            (receipt obtained_via=dispatch) ──> verified | verification_failed
            ──> failed_retryable     (provider definitively did nothing; bounded retries)
            ──> failed_permanent
            ──> uncertain ──> reconciling ──> succeeded (receipt obtained_via=reconciliation)
                                          ──> failed_retryable (authoritatively absent) ──> dispatch again
                                          ──> uncertain (provider can't answer; retry, then stop and surface)
```

Every transition is compare-and-set on the current status and appended to `action_transitions`.
Crash recovery: a dispatch job that finds its action already `dispatching` moves it to `uncertain`; a cron sweeper does the same for actions stuck in `dispatching` beyond 5 minutes.

## Authority

`evaluatePolicy` order: closed goal → deny; destructive → deny (v0); any external target not a goal participant → deny; read/draft → allow; write_self with no targets → allow; otherwise an active, unexpired envelope must contain a permit for this capability whose recipients cover every target, whose capability-specific constraints hold, and which has uses left.
