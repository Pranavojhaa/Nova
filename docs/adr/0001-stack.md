# 0001 TypeScript modular monolith on Postgres

**Decision:** TypeScript (Node 22) end to end; Fastify API and graphile-worker worker from one codebase; Postgres 16 as system of record and job queue; Drizzle with generated, committed SQL migrations; Zod at boundaries; Vitest; Playwright once there is UI.

**Why:** one language shares domain and schema types across API, worker and web; Postgres-backed jobs give transactional enqueue (state change and follow-up job commit together) without Redis/Temporal. No Python unless a capability genuinely needs it.

**Revisit when:** measured job throughput or latency exceeds what Postgres polling/LISTEN can serve.
