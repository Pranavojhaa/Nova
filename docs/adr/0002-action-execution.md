# 0002 Exactly-once external effects via ledger + reconciliation

**Decision:** every external effect is an `actions` row with an idempotency key (`goal:capability:semantic-key`) and a frozen, hashed payload. Dispatch commits `dispatching` before calling the provider. Any non-definitive failure makes the action `uncertain`, and only reconciliation (lookup by the Nova action id stamped on the provider artifact) can lead to another dispatch. Receipts record how success was established; verification re-reads provider state.

**Why:** a duplicate email to another person is worse than a delayed one. Retries are not assumed safe.

**Consequence:** every capability must stamp the action id and implement an authoritative `reconcile`; an eventually consistent provider must throw rather than report "not found".
