# Security and data-handling conventions

These exist from M0 because Gmail's restricted scopes require Google OAuth verification and an annual security assessment (CASA) before Nova can serve more than 100 users. Build as if the assessor is reading.

## Secrets

- Read from the environment only in `src/platform/config.ts`, validated at startup. Errors name keys, never values.
- `.env` is for local development only and is git-ignored. Production secrets come from the host's secret manager.
- `NOVA_MASTER_KEY` (32 bytes) wraps per-value data keys (`SecretBox`, AES-256-GCM, context-bound AAD such as `connection:<id>`). Rotation re-wraps data keys.
- OAuth tokens are stored only as `connections.token_ciphertext`. Plaintext tokens never touch the database, logs, the model, or error payloads.
- Logger redacts token/secret/authorization paths (`src/platform/logger.ts`). Add new sensitive field names there.
- CI runs gitleaks on every push.

## Google OAuth

- Separate Google Cloud projects (and OAuth clients) for development/staging and production. Never share a client between them.
- Request the minimum scopes for the capability being built, incrementally. Planned: `gmail.send`, `gmail.readonly` (or `gmail.metadata` where enough), `calendar.events`, `calendar.freebusy`.
- Test users on the dev project until verification.

## Data minimization, export, deletion

- Store provider ids and extracted facts, not whole mailboxes. Message bodies are fetched on demand for a turn and not persisted beyond what the goal needs.
- Every user-owned table cascades from `users(id)`; deleting a user deletes their data (tested).
- User data export lands with M2 (goals, actions, receipts, envelopes, Brain).

## Authority and prompt injection

- The model's output is a request, never a permission. Policy is deterministic and never reads model rationale.
- Recipient pinning: external targets must be goal participants, set from the user's instruction, never from content Nova reads.
- Untrusted content (emails, web) is labeled as data in prompts; this is defense in depth, not the boundary.
- Authorization envelopes are hash-bound, versioned, revocable, superseded on material change, and re-checked before every dispatch.

## Audit

`actions` + `action_transitions` + `receipts` + `authorization_envelopes` answer, for every external effect: what was sent (content hash), to whom, under which envelope version and permit, how we know it happened, and whether an independent re-read verified it.
