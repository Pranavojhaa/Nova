# 0005 Three environments on GCP; prod behind a written readiness gate

**Decision:** dev (local), staging and prod are separate GCP projects with separate databases, Google OAuth projects,
master keys and deployers. One image is built per commit; staging deploys every push to `main`, smoke-tests it,
and tags the digest `verified-<sha>`. Prod runs only verified digests, via a manual workflow in the `production`
GitHub environment that refuses while `docs/prod-readiness.md` has an unchecked box. Outside prod, a required
recipient allowlist is enforced by policy as a hard deny.

`promote.yml` splits that manual workflow into two jobs so the readiness gate never runs with cloud credentials in
scope: an unprivileged `gate` job (no `id-token`, no GCP auth) validates the dispatched SHA is a full commit SHA and
an ancestor of `main`, then runs `pnpm readiness` against `docs/prod-readiness.md` at that SHA; only if that passes
does the privileged `promote` job (the `production` environment, gated on a required reviewer) run at all, and it
re-proves the SHA is on `main` before requesting GCP credentials — it never trusts the `gate` job's result alone.
`promote` then resolves the SHA to the `verified-<sha>` tag staging produced, refuses to deploy unless the image's
baked `NOVA_RELEASE` equals the promoted SHA, deploys that digest, and smoke-tests it. Workload Identity Federation
is further restricted to `assertion.ref == "refs/heads/main"`, so both staging deploys and prod promotes can only
run from `main`.

**Why:** Nova is heading to real users, and Google verification expects isolated environments. The allowlist exists
because staging uses real Gmail: a pre-release bug must not be able to email real people. The written gate keeps
"tested enough for prod" from being a feeling.

**Consequences:** the always-on worker is the main cost (~$45–50/month per environment); staging's worker is paused
between test sessions once prod exists. Migrations must be backward compatible with the previous release. Terraform,
gcloud and Docker become required tools for whoever bootstraps an environment.
