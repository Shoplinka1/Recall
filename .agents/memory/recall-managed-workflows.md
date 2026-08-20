---
name: Recall managed workflows
description: Runtime constraint for the imported Recall monorepo's service workflows.
---

The artifact-owned API and web workflows are the authoritative services for Recall. The legacy Recall API and Recall Web workflows use the same ports and must be stopped before restarting the managed services.

**Why:** Running both copies produces misleading EADDRINUSE failures even when the application itself builds and starts correctly.

**How to apply:** Use `artifacts/api-server: API Server` and `artifacts/recall: web`; do not restart the legacy workflows for verification.