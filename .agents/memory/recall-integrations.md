---
name: Recall integrations
description: Why Recall starts with grounded demo services and where production integrations fit.
---

Recall should preserve a complete learning loop even when external services are not configured. AI generation must remain grounded in stored material excerpts, while provider selection stays behind a service boundary. Billing should be driven by server-side Stripe state and file uploads should use private object storage rather than public URLs.

**Why:** The core product value is diagnosing what a student does not know; a deterministic demo lets the UX and scoring be exercised without silently pretending that AI generation, billing, or private storage are active.

**How to apply:** When production integrations are added, replace the isolated service implementations and keep the generated API contracts plus the demo path available for development and local testing.