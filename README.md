# Nova

A persistent personal delegation agent. You tell Nova what you want taken care of; it owns the outcome:
plans, acts through authorized capabilities, waits for the world to respond, verifies, and tells you when it's done.

**Status:** M0 foundation. No provider integrations yet. See `docs/foundation-plan.md` for the plan and milestones.

## Run locally

```sh
pnpm install
docker compose up -d                 # Postgres 16 with nova_dev and nova_test
cp .env.example .env                 # then set NOVA_MASTER_KEY (see the file)
pnpm db:migrate
pnpm dev:api                         # http://localhost:3000/healthz
pnpm dev:worker
pnpm check                           # everything CI runs
```

## Layout

```
src/platform/     infrastructure: config, logging, clock, ids, hashing, crypto, db, jobs
src/modules/      domain modules, each with index.ts (public API) and schema.ts (its tables)
src/api/          HTTP surface (thin)
src/entrypoints/  api, worker, migrate
drizzle/          generated, committed SQL migrations
tests/            integration tests, fakes, helpers
docs/             architecture, security, ADRs, foundation plan
```
