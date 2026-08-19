---
name: Recall runtime setup
description: Environment-specific setup lessons for running the imported Recall workspace.
---

Imported Recall workspaces can have configured workflows but no installed node_modules, and the PostgreSQL connection can be available before the Drizzle schema exists in the development database.

**Why:** A healthy database connection alone does not prove the application schema is present, and workflow processes may fail with missing local binaries until the lockfile dependencies are installed.

**How to apply:** Before runtime verification, install from pnpm-lock.yaml, provision App Storage when upload flows are exercised, run the existing Drizzle push command for the development schema, then restart the existing Recall API and web workflows. If the app is not registered with the artifact registry, use direct HTTP checks and report that screenshot capture is unavailable rather than creating a replacement artifact.