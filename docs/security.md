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

- One Google Cloud project, OAuth client and `NOVA_MASTER_KEY` per environment (dev, staging, prod). Never share a client or key between them; prod data is never copied into staging or dev.
- Request the minimum scopes for the capability being built, incrementally. Planned: `gmail.send`, `gmail.readonly` (or `gmail.metadata` where enough), `calendar.events`, `calendar.freebusy`.
- Test users on the dev and staging projects; only the prod project goes through verification.

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

## Deployment

- GitHub Actions authenticates to GCP only through Workload Identity Federation, restricted to `Pranavojhaa/Nova` jobs in the matching GitHub environment. No service-account key files exist.
- Secret values (`DATABASE_URL`, `NOVA_MASTER_KEY`) are written with `gcloud` and never pass through Terraform state or CI logs.
- Cloud SQL has no authorized networks; only the IAM-checked Cloud SQL connector reaches it.
- Outside prod, `NOVA_RECIPIENT_ALLOWLIST` is required and enforced by policy as a hard deny at proposal and before dispatch, so pre-release builds cannot contact real people.
- Residual risk: whoever can get code deployed can indirectly read secret values, since that code runs as the runtime service account and can exfiltrate anything it can read. This is inherent to continuous deployment, not specific to Nova. Mitigated, not eliminated, by GitHub environment protection (deploys restricted to `main`, a required reviewer on `production`) and by Workload Identity Federation being pinned to one repository, one GitHub environment and one branch.
