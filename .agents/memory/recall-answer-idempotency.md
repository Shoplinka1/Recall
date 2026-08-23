---
name: Recall answer idempotency
description: The answer endpoint's repeated-submission contract for teaching interventions and follow-up questions.
---

An already-persisted answer must return the same teaching intervention and follow-up question on repeat requests; it must not select or append a new follow-up.

**Why:** A client retry or double-click is normal network behavior. Generating a different follow-up makes the response non-idempotent and can grow a session with duplicate conceptual interventions.

**How to apply:** Resolve an existing intervention by attempt before follow-up selection. Reuse its persisted follow-up ID and status, while preserving the original server-side answer, score, and ownership checks.