# Environments and deploys

Design: `docs/superpowers/specs/2026-09-27-environments-and-prod-gate-design.md`. ADR: `docs/adr/0005-environments-and-prod-gate.md`.

|                     | dev                                | staging                                    | prod                                |
| ------------------- | ---------------------------------- | ------------------------------------------ | ----------------------------------- |
| Where               | your laptop                        | GCP project `nova-staging-*`               | GCP project `nova-prod-*` (M5)      |
| Deploys             | `pnpm dev:api` / `pnpm dev:worker` | every push to `main` (CI `deploy-staging`) | manual: Actions → _Promote to prod_ |
| Recipient allowlist | required                           | required                                   | optional                            |

## Tools (once)

`brew install --cask google-cloud-sdk && brew install terraform`, plus Docker (OrbStack or Docker Desktop).
`gcloud auth login && gcloud auth application-default login`.

## GitHub environments (once)

Both deploy jobs run in a GitHub environment (`staging` or `production`), and Workload Identity Federation only
accepts tokens from `Pranavojhaa/Nova` jobs in that environment **on the `main` branch**
(`assertion.ref == "refs/heads/main"`, set in `infra/terraform/modules/nova-env/main.tf`). So both environments must
restrict deploys to `main`, or a WIF token request from another branch will simply fail late instead of being refused
up front by GitHub.

Set the deployment branch policy for each environment to **main only**, and — for **production** only — require
Pranav as a reviewer, so nobody (including CI) can advance `promote` past the `gate` job without an explicit human
approval. Do this in **one `PUT` per environment**: the environment `PUT` endpoint replaces the fields it's given,
so a later `PUT` that omits `deployment_branch_policy` can silently reset the policy set by an earlier one — the
reviewer must be set in the same call, not a second one:

```sh
for env in staging production; do
  reviewer_args=()
  if [[ "$env" == production ]]; then
    USER_ID="$(gh api users/Pranavojhaa -q .id)"
    reviewer_args=(-F 'reviewers[][type]=User' -F "reviewers[][id]=$USER_ID")
  fi
  gh api -X PUT "repos/Pranavojhaa/Nova/environments/$env" \
    -f 'deployment_branch_policy[protected_branches]=false' \
    -F 'deployment_branch_policy[custom_branch_policies]=true' \
    "${reviewer_args[@]}"
  gh api -X POST "repos/Pranavojhaa/Nova/environments/$env/deployment-branch-policies" -f name=main
done
```

If the `gh api` syntax above has drifted from what your `gh` version expects, do it in the UI instead: repo →
Settings → Environments → `<env>` → "Deployment branches and tags" → "Selected branches and tags" → add `main`; and
for `production`, "Required reviewers" → add Pranavojhaa.

Once this section is done, never issue another bare `gh api -X PUT repos/Pranavojhaa/Nova/environments/<env>` (for
example just to create the environment before setting variables) — it re-sends the environment's configuration, and
omitting `deployment_branch_policy` or `reviewers` from that later call can reset what this section just set. The
environment already exists after the loop above; later steps only need `gh variable set --env <env>`.

## Bootstrap staging (once)

Do the "GitHub environments (once)" section above first — it's what sets `staging`'s deployment branch policy, and
the step below only adds variables to an environment that must already exist with that policy in place.

```sh
export PROJECT=nova-staging-<suffix>      # globally unique
export REGION=asia-south1
gcloud projects create "$PROJECT"
gcloud billing projects link "$PROJECT" --billing-account=<BILLING_ACCOUNT_ID>
# The budget flags below weren't executed against a real billing account here; if this errors, check
# `gcloud billing budgets create --help` for the current flag names.
gcloud billing budgets create --billing-account=<BILLING_ACCOUNT_ID> \
  --display-name="nova-staging" --budget-amount=100USD \
  --filter-projects="projects/$PROJECT" \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0

# Terraform state bucket
gcloud storage buckets create "gs://$PROJECT-tfstate" --project "$PROJECT" --location "$REGION" \
  --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update "gs://$PROJECT-tfstate" --versioning

cd infra/terraform/envs/staging
echo "project_id = \"$PROJECT\"" > terraform.tfvars
terraform init -backend-config="bucket=$PROJECT-tfstate"
terraform apply
git add terraform.tfvars .terraform.lock.hcl && git commit -m "infra: staging project id and provider lock"
```

Secret values (never through Terraform):

```sh
DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=')"
gcloud sql users create nova --instance=nova-staging --password="$DB_PASSWORD" --project "$PROJECT"
CONN="$(terraform output -raw sql_connection_name)"
printf 'postgresql://nova:%s@localhost/nova?host=/cloudsql/%s' "$DB_PASSWORD" "$CONN" \
  | gcloud secrets versions add DATABASE_URL --data-file=- --project "$PROJECT"
openssl rand -base64 32 | tr -d '\n' | gcloud secrets versions add NOVA_MASTER_KEY --data-file=- --project "$PROJECT"
unset DB_PASSWORD
```

GitHub (repo → Settings → Environments → **staging**, already created with its deployment branch policy set in the
section above — don't re-`PUT` the environment here: a `PUT` with no `deployment_branch_policy` body can reset that
policy back to "all branches"), variables from `terraform output`:

```sh
for kv in \
  "GCP_PROJECT_ID=$PROJECT" "GCP_REGION=$REGION" \
  "REGISTRY=$(terraform output -raw registry)" \
  "SQL_CONNECTION=$(terraform output -raw sql_connection_name)" \
  "RUNTIME_SA=$(terraform output -raw runtime_service_account)" \
  "DEPLOYER_SA=$(terraform output -raw deployer_service_account)" \
  "WIF_PROVIDER=$(terraform output -raw workload_identity_provider)" \
  "NOVA_RECIPIENT_ALLOWLIST=<your-test-address-1>,<your-test-address-2>" \
  "WORKER_MIN_INSTANCES=1"; do
  gh variable set "${kv%%=*}" --env staging --body "${kv#*=}"
done
gh variable set STAGING_DEPLOY_ENABLED --body true
```

The next push to `main` deploys. Check: the `deploy-staging` job ends with `smoke test passed`.

## Pause and resume the staging worker (cost)

Paused, staging costs ~$12/month instead of ~$60. Timers and polling don't run while paused.

```sh
gcloud run services update nova-worker --min-instances 0 --region asia-south1 --project "$PROJECT"   # pause
gcloud run services update nova-worker --min-instances 1 --region asia-south1 --project "$PROJECT"   # resume
```

Also set the `WORKER_MIN_INSTANCES` variable to match, or the next deploy undoes it.

## Roll back

Code only (migrations are forward-only and expand-compatible):

```sh
gcloud run revisions list --service nova-api --region asia-south1 --project "$PROJECT"
gcloud run services update-traffic nova-api --to-revisions <previous-revision>=100 --region asia-south1 --project "$PROJECT"
gcloud run services update-traffic nova-worker --to-revisions <previous-revision>=100 --region asia-south1 --project "$PROJECT"
```

If the **prod** smoke test fails after a promote, the new revision is already serving traffic — `scripts/deploy.sh`
switches traffic to the new revision as part of `gcloud run deploy`, and the smoke test only runs after. Roll back
immediately with the traffic commands above, run for **both** services (`nova-api` and `nova-worker`) against the
prod project, pointing at the previous known-good revision.

## Migrations rule

The old API keeps serving while migrations and the new worker roll out, so every migration must work with the
previous release: add columns and tables first, backfill, switch code, and only drop in a later release.

## Prod (M5, only after `docs/prod-readiness.md` is complete)

1. Repeat the bootstrap with `PROJECT=nova-prod-<suffix>` in `infra/terraform/envs/prod`, with instance `nova-prod`.
   Prod's Cloud SQL instance also has GCP-level deletion protection
   (`settings.deletion_protection_enabled`, set by `db_deletion_protection = true` in
   `infra/terraform/envs/prod/main.tf`), on top of Terraform's own `deletion_protection`; both must be turned off
   before the instance can ever be destroyed.
2. In staging's `terraform.tfvars` add `prod_project_number = "<prod project number>"` and
   `prod_deployer_service_account = "<prod deployer email>"`, then `terraform apply` (prod can now pull verified
   images from staging's Artifact Registry).
3. Create the GitHub environment **production** with deployment branch policy = main only, **required reviewer:
   Pranavojhaa** (both set above), the same variables (with `REGISTRY` = the _staging_ registry), and
   `WORKER_MIN_INSTANCES=1`.
4. Actions → _Promote to prod_ → the SHA currently on staging. This dispatches `promote.yml`, which runs in two
   jobs:
   - `gate` (unprivileged, no GCP credentials): checks the SHA is a full 40-character hex commit SHA and an ancestor
     of `main`, then runs `pnpm readiness docs/prod-readiness.md` at that SHA. Any unchecked box, or a SHA that isn't
     on `main`, fails the workflow before any cloud credential is ever requested.
   - `promote` (the `production` GitHub environment, so it waits for the required reviewer): re-proves the SHA is
     on `main` itself, then resolves the `verified-<sha>` tag (the digest that staging built, deployed and
     smoke-tested) to its image digest, refuses unless that image's baked `NOVA_RELEASE` equals the promoted SHA,
     deploys that exact digest with `scripts/deploy.sh`, and smoke-tests it.
     Because a workflow dispatched from a non-`main` branch also fails the deployment branch policy set above, "Promote
     to prod" must be run with `main` selected as the branch to run the workflow from.

## Deploying somewhere new

`scripts/deploy.sh` refuses to run for a non-prod environment (`NOVA_ENV` other than `prod`) when
`NOVA_RECIPIENT_ALLOWLIST` is empty, before it touches GCP at all — a new staging-like environment without an
allowlist configured is a mistake, not a valid deploy target.
