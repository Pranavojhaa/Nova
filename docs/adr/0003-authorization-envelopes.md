# 0003 Bounded authorization envelopes instead of per-step approval

**Decision:** the user approves a versioned, hash-bound envelope per goal ("email Rahul these times, book the slot he accepts, follow up once by Friday"). Terms are permits: capability + pinned recipients + capability-specific constraints + max uses + expiry. The web inbox is the only approval surface; email deep-links into it.

**Why:** step-by-step approval makes Nova a prompt-driven assistant; no approval makes it reckless. Envelopes let Nova act autonomously inside a boundary the user understood.

**Guards:** approval must present the current terms hash and the latest version; any material goal change supersedes envelopes; policy re-evaluates every action before dispatch with the permit reserved under a row lock; destructive actions are never envelope-authorizable in v0.
