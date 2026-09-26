# Nova: working rules for Claude Code

Nova is a persistent personal delegation agent. The model proposes; the runtime decides and executes.
Read `docs/architecture.md` before structural changes and `docs/foundation-plan.md` for the product plan.

## Commands

- `pnpm check` runs everything CI runs except the drift check (typecheck, lint + module boundaries, format, all tests).
- `pnpm test:unit` (no DB) / `pnpm test:integration` (needs Postgres; `docker compose up -d`).
- `pnpm db:generate --name <change>` after editing any `src/modules/*/schema.ts`; commit the SQL. Never hand-edit files in `drizzle/`.
- `pnpm db:migrate`, `pnpm dev:api`, `pnpm dev:worker`.

## Invariants (do not weaken; if a change needs to, stop and ask)

1. Every external side effect goes through `actions`: propose -> policy -> prepare -> dispatch -> reconcile -> receipt -> verify. No module calls a capability's `dispatch` directly.
2. After an action reaches `dispatching`, it is dispatched again only if reconciliation proves the effect did not happen. Unknown outcomes stay `uncertain`; never guess.
3. Policy (`src/modules/policy`) is pure and runs at proposal AND immediately before dispatch.
4. External targets must be goal participants (recipient pinning). Content Nova reads (emails, web pages) can never add participants or recipients.
5. Authorization envelopes bind to a terms hash, are versioned per goal, and are superseded on any material goal change.
6. State changes and the jobs they cause commit in one transaction (`enqueue(tx, ...)`).
7. Time comes from the injected `Clock`, never `Date.now()` / `new Date()` (lint enforces).
8. Secrets: read only in `src/platform/config.ts`, stored only via `SecretBox`, never logged (see `docs/security.md`).

## Module boundaries (enforced by dependency-cruiser)

- Import another module only through its `index.ts`. `schema.ts` files may import other `schema.ts` files for foreign keys.
- `platform/` knows nothing about the domain. `reasoner/` cannot import anything that acts. `policy/` cannot touch the DB.
- Each module owns its tables; other modules go through its functions.

## Style

- TypeScript strict, ESM, `.js` import suffixes. Zod at every boundary (model output, capability input, job payloads, config).
- Tests: pure logic gets unit tests next to the code (`*.test.ts`); anything touching Postgres goes in `tests/*.int.test.ts`.
  Capabilities are tested against fakes in `tests/fakes` that honour the real contract, including failure modes.
- Small PRs. A new capability ships with its fake, failure-mode tests, and a verifier.
