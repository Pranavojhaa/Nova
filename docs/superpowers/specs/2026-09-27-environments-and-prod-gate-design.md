# Environments, test levels and the prod gate

Status: draft for review. Date: 2026-09-27. Amends `docs/foundation-plan.md` §7 build order.
Confidence tags as in the foundation plan: **[Certain]**, **[Likely]**, **[Guessing]**.

Review note: §1 (environments and configuration) was agreed in conversation. §2–§5 use the defaults Claude proposed and have not been discussed yet. Read them closely.

---

## 0. Intent

**What Pranav said.** Nova should become a sellable product, not only a personal tool. The order is:

1. **Validate:** up to 100 users inside Google's unverified-app cap.
2. **Launch:** self-serve, with Google OAuth verification and CASA.

Before anyone else uses it, Nova needs production-grade engineering: **dev, staging and prod builds of the same app**, each with its own database, Google OAuth project and secrets, and changes promoted dev → staging → prod. It runs on **Google Cloud** for **under $100/month**. The product comes first: nothing reaches prod until it has been properly tested.

**Assumptions.** "Ready for scale" means safe and repeatable to run for other people. It does not mean an architecture for millions of users. Billing, teams, multi-account and marketing are out of scope here.

**Success looks like this:**

- Every merge to `main` is running on staging within minutes, with a smoke test proving it.
- Staging cannot email anyone outside a configured allowlist.
- Prod exists as code but isn't provisioned. It gets provisioned and receives its first deploy only when a written readiness checklist is complete. After that, prod receives only images that already passed staging.
- Each product milestone adds the test level that becomes meaningful at that point.

## 1. Environments and configuration (agreed)

|                        | dev                                          | staging                                  | prod                                                              |
| ---------------------- | -------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| Runs on                | laptop: Docker Compose Postgres, `tsx watch` | GCP project `nova-staging-*`             | GCP project `nova-prod-*`, defined now, provisioned at M5         |
| Database               | local container                              | Cloud SQL, `db-f1-micro`, no backups     | Cloud SQL, backups + PITR, deletion protection                    |
| Google OAuth (from M1) | `nova-dev` OAuth project, test users         | `nova-staging` OAuth project, test users | `nova-prod` OAuth project, the one that goes through verification |
| Secrets                | `.env` (git-ignored)                         | Secret Manager                           | Secret Manager                                                    |
| `NOVA_MASTER_KEY`      | its own                                      | its own                                  | its own                                                           |

- Every environment has its own OAuth project. This tightens `docs/security.md`, which previously let dev and staging share one. Separate master keys mean ciphertext can't move between environments. **Prod data is never copied into staging or dev.**
- New config keys:
  - `NOVA_ENV` (`dev | staging | prod`): the deployment's identity. It's separate from `NODE_ENV`, because staging also runs `NODE_ENV=production`.
  - `NOVA_RELEASE`: the git SHA baked into the image. It appears in logs and `/version`.
  - `NOVA_RECIPIENT_ALLOWLIST`: comma-separated email addresses.
  - `HEALTH_PORT`: the worker's liveness port.
  - Google OAuth keys arrive with M1, not before.
- **Staging safety rail.** In dev and staging, `NOVA_RECIPIENT_ALLOWLIST` is **required**. Config refuses to start without it. Policy enforces it as a hard rule: any external target outside the allowlist is **denied** (`recipient_not_allowlisted`), for every risk class, both at proposal and immediately before dispatch.
  - Policy stays pure: the allowlist is input data, like the envelope.
  - In prod the allowlist is optional. When set, it restricts prod the same way, which is useful for the first prod smoke test before opening to users.
  - Comparison is case-insensitive.

## 2. GCP layout (default, not yet reviewed)

One GCP project per environment. Region `asia-south1` (Mumbai) [Likely: closest to the first users].

- **Infrastructure as code:** Terraform, one shared module (`infra/terraform/modules/nova-env`) and one root per environment (`infra/terraform/envs/{staging,prod}`). State lives in a GCS bucket per environment. CI runs `fmt` and `validate` on both roots. Only staging is applied in M0.5.
- **Per project:** enabled APIs, a Cloud SQL Postgres 16 instance and database, Secret Manager secrets (`DATABASE_URL`, `NOVA_MASTER_KEY`), a runtime service account (Cloud SQL client, secret accessor), a deployer service account, and a GitHub Workload Identity Federation provider.
  - The WIF provider only accepts tokens from `Pranavojhaa/Nova` jobs running in the matching GitHub environment. **No JSON service-account keys exist anywhere.**
- **Secret values are never in Terraform state.** Terraform creates the secret containers; the runbook writes values with `gcloud`. The DB user is created the same way.
- **Database access:** Cloud Run's built-in Cloud SQL connection (unix socket, IAM-checked). The instance has a public IP but no authorized networks, so it can only be reached through the connector.
  - `DATABASE_URL` is `postgresql://nova:<pw>@localhost/nova?host=/cloudsql/<connection-name>`.
- **Artifact Registry:** one repository, in the staging project. At M5, staging's Terraform grants prod's Cloud Run service agent and prod's deployer read access, so prod runs _the same digest_ that passed staging.

## 3. Build and promotion pipeline (default, not yet reviewed)

- **One image.** A multi-stage Dockerfile on `node:22-slim` with prod dependencies only, running as a non-root user. `NOVA_RELEASE` is baked in at build time. The same image runs as API, worker or migrate by changing the command.
- **CI on every PR and push** (additions to the existing `check` job):
  - `image`: build the image, run migrations against a CI Postgres, start the API and worker containers, and run the smoke test against both.
  - `terraform`: `fmt -check` and `validate` for both environment roots.
- **Deploy to staging** on every push to `main` once all CI jobs pass. The job runs in GitHub environment `staging`:
  1. Build, push to the registry and resolve the digest.
  2. Deploy with `scripts/deploy.sh`:
     - run migrations as a Cloud Run job, then the worker, then the API;
     - the worker is a Cloud Run service with one always-on instance, CPU always allocated, and internal ingress;
     - the API scales to zero and is public.
  3. Smoke-test the public API.
  4. **Tag the digest `verified-<sha>`.**
- **Promote to prod** is a manual `workflow_dispatch` taking a SHA, in GitHub environment `production`, which requires Pranav's approval. It refuses to run unless:
  - `docs/prod-readiness.md` at that SHA has no unchecked boxes;
  - a `verified-<sha>` tag exists.

  It then deploys that exact digest with the same script and smoke-tests it.

- **Migrations are forward-only**, as they already are, and must stay compatible with the previous release (expand, then contract), because the old API revision serves traffic while the new worker starts.
- **Rollback:** move Cloud Run traffic back to the previous revision. There is never a down-migration.
- **Deploys are never cancelled mid-flight.** Workflow concurrency cancels superseded runs only for pull requests.

## 4. Test levels (default, not yet reviewed)

Each level lands with the milestone that first has something real for it to test.

| Level                                         | What it proves                                                                                    | Lands in    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------- |
| Unit                                          | pure logic (policy, state machines, config)                                                       | exists (M0) |
| Integration                                   | modules against real Postgres                                                                     | exists (M0) |
| Image                                         | the shipped container migrates, boots and serves                                                  | M0.5        |
| Post-deploy smoke                             | the deployed release is the expected SHA, healthy, and reaching its DB                            | M0.5        |
| Contract                                      | each fake in `tests/fakes` behaves like the real Google API, run on staging against test accounts | M1          |
| E2E                                           | web approval flow in Playwright against staging                                                   | M2          |
| Crash/recovery                                | killing the worker mid-dispatch never double-sends; stuck `uncertain` actions alert               | M3          |
| Scenario evals                                | the full slice plus prompt-injection scenarios, run as a gate before promoting                    | M4          |
| Tenant isolation, export/deletion, rough load | one user can never see or affect another; data rights work                                        | M5          |

## 5. The prod gate (default, not yet reviewed)

Prod is provisioned (`terraform apply` on `envs/prod`) and receives its first deploy only when `docs/prod-readiness.md` is fully checked. Each item needs a line of evidence: a link, a run ID or a date.

The promote workflow enforces the checkbox part mechanically. Starting items:

- The full meeting slice has succeeded end to end on staging at least 10 times with no manual repair.
- Scenario evals, including injection, are green on the release being promoted.
- Crash/recovery tests are green, and no action sat in `uncertain` unresolved on staging for the past 14 days.
- Tenant isolation tests pass.
- User data export and deletion work (deletion tested end to end).
- A Cloud SQL backup has been restored into a scratch instance and the app booted against it.
- A billing budget alert is set on both projects.
- The staging allowlist rule is covered by tests, and prod's config has been reviewed.
- A privacy policy and terms of service are published (needed for OAuth verification).

## 6. Budget [Likely: verify with the GCP pricing calculator during the runbook]

| Item                                 | Staging | Prod (from M5)      |
| ------------------------------------ | ------- | ------------------- |
| Cloud SQL (`db-f1-micro`, 10 GB)     | ~$10–12 | ~$12–15 (+ backups) |
| Worker (1 vCPU / 512 MiB, always on) | ~$45–50 | ~$45–50             |
| API (scale to zero)                  | ~$0–2   | ~$1–5               |
| Registry, secrets, logs              | ~$1–2   | ~$1–2               |

- **Staging alone:** ~$60/month.
- **Staging + prod:** ~$120/month, **over budget**. So once prod exists, the staging worker is **paused** (`WORKER_MIN_INSTANCES=0`) outside test sessions, which brings staging down to ~$12 and the total to ~$75.
- A GCP billing budget alert at $100 is set during bootstrap.
- If the always-on worker turns out to be the dominant cost, the fallback is a small Compute Engine VM for the worker. That's out of scope unless the numbers force it.

## 7. Out of scope

Preview environments per PR; autoscaling the worker beyond one instance; Gmail push/webhooks; multi-region; a CDN; billing and payments; the web app deployable (added in M2 using the same pattern); OAuth client creation (M1, via the runbook, because the consent screen can't be managed by Terraform).
