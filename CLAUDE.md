# Nova: working rules for Claude Code

Nova is a persistent personal delegation agent: it owns outcomes, not conversations. **The model proposes; the runtime decides and executes.**

Before structural work, read:

- `docs/architecture.md`: what is built.
- `docs/cognitive-architecture.md`: how Nova thinks. That covers the Brain, the Context Engine, and the Reasoner's role and limits. Read it before touching `brain`, `context`, `reasoner` or `agenda`.
- `docs/foundation-plan.md`: the product plan and milestones.

## Commands

- `pnpm check` runs everything CI runs except the drift check: typecheck, lint with module boundaries, format, and all tests.
- `pnpm test:unit` needs no database. `pnpm test:integration` needs Postgres (`docker compose up -d`).
- After editing any `src/modules/*/schema.ts`, run `pnpm db:generate --name <change>` and commit the SQL. Never hand-edit files in `drizzle/`.
- Other commands: `pnpm db:migrate`, `pnpm dev:api`, `pnpm dev:worker`. Local config lives in `.env` (see `.env.example`). Outside prod, `NOVA_RECIPIENT_ALLOWLIST` is required.

## Engineering invariants

Do not weaken these. If a change needs to, stop and ask.

1. **Every external side effect goes through `actions`.** The path is propose → policy → prepare → dispatch → reconcile → receipt → verify. No module calls a capability's `dispatch` directly.
2. **Unknown outcomes stay `uncertain`; never guess.** Once an action reaches `dispatching`, it is dispatched again only if reconciliation proves the effect did not happen.
3. **Policy (`src/modules/policy`) is pure.** It runs at proposal AND immediately before dispatch. Environment rules, such as the non-prod recipient allowlist, reach it as input data.
4. **Recipient pinning.** External targets must be goal participants. Content Nova reads (emails, web pages, documents) can never add participants, recipients, authority or user beliefs.
5. **Authorization envelopes** bind to a terms hash, are versioned per goal, and are superseded on any material goal change. Approval is bounded and per goal, not per step. Policy still checks every action.
6. **State changes and the jobs they cause commit in one transaction** (`enqueue(tx, ...)`).
7. **Time comes from the injected `Clock`,** never `Date.now()` or `new Date()`. Lint enforces this.
8. **Secrets** are read only in `src/platform/config.ts`, stored only via `SecretBox`, and never logged. See `docs/security.md`.
9. **Verification is outside the model.** A receipt plus an independent re-read of provider state, never a model's claim.
10. **The Reasoner returns data only.** It cannot write state, persist memory or grant authority. Memory goes in as proposals with evidence, and the Brain's write policy decides.
11. **The Reasoner stays provider-agnostic.** The context contract belongs to Nova, not to any model vendor.
12. **Complexity must earn its place.** Add infrastructure or cognitive mechanisms only with a measurable benefit over a simpler baseline.

The product-level invariants these implement are in `docs/cognitive-architecture.md` §28.

## Module boundaries

These are enforced by dependency-cruiser.

- Import another module only through its `index.ts`. `schema.ts` files may import other `schema.ts` files for foreign keys.
- `platform/` knows nothing about the domain. `reasoner/` cannot import anything that acts. `policy/` cannot touch the database.
- Each module owns its tables. Other modules go through its functions.

## Style

- TypeScript strict, ESM, with `.js` import suffixes.
- Zod at every boundary: model output, capability input, job payloads and config.
- Pure logic gets unit tests next to the code (`*.test.ts`). Anything touching Postgres goes in `tests/*.int.test.ts`.
- Capabilities are tested against fakes in `tests/fakes` that honour the real contract, including its failure modes.
- Keep PRs small. A new capability ships with its fake, failure-mode tests and a verifier.
