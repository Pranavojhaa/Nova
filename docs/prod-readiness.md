# Prod readiness gate

Prod is provisioned (`terraform apply` in `infra/terraform/envs/prod`) and promoted to only when every box below is
checked **with evidence** (link, run id, or date). `promote.yml` refuses while any box is unchecked.
Adding items is fine; removing one needs a note in the commit message explaining why.

## Product

- [ ] Full "coordinate a meeting" slice succeeded end to end on staging ≥ 10 times with no manual repair. Evidence:
- [ ] Scenario evals (including prompt-injection) green on the release being promoted. Evidence:

## Reliability

- [ ] Crash/recovery tests green (worker killed mid-dispatch never double-sends). Evidence:
- [ ] No action left in `uncertain` unresolved on staging for the last 14 days. Evidence:
- [ ] A Cloud SQL backup restored into a scratch instance and the app booted against it. Evidence:

## Security and data

- [ ] Tenant isolation tests pass (one user can never read or affect another's data). Evidence:
- [ ] User data export and deletion work; deletion tested end to end. Evidence:
- [ ] Staging recipient allowlist covered by tests; prod config (`NOVA_RECIPIENT_ALLOWLIST` set or deliberately unset) reviewed. Evidence:
- [ ] `nova-prod` Google OAuth project created with minimum scopes; consent screen complete. Evidence:

## Operations

- [ ] Billing budget alert at $100 on both projects. Evidence:
- [ ] Privacy policy and terms of service published (required for OAuth verification). Evidence:
