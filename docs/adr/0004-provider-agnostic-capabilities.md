# 0004 Provider-agnostic capabilities; Gmail is the first provider, not the boundary

**Decision:** capabilities are named by what they do (`email.send`, `calendar.create_event`) and declare risk, input schema, external targets, permit checks, dispatch, reconcile and verify. Provider adapters (Gmail, Google Calendar) implement them over a `connections` abstraction.

**Why:** Gmail's restricted scopes make it an expensive dependency (verification, CASA, 100-user cap until then). Keeping it behind one adapter keeps the core honest and lets other providers slot in.
