---
name: Recall runtime setup
description: Environment-specific setup lessons for running the imported Recall workspace.
---

Imported Recall workspaces can have configured workflows but no installed node_modules, and the PostgreSQL connection can be available before the Drizzle schema exists in the development database.

**Why:** A healthy database connection alone does not prove the application schema is present, and workflow processes may fail with missing local binaries until the lockfile dependencies are installed.

**How to apply:** Before runtime verification, install from pnpm-lock.yaml, provision App Storage when upload flows are exercised, run the existing Drizzle push command for the development schema, then restart the existing Recall API and web workflows. If the app is not registered with the artifact registry, use direct HTTP checks and report that screenshot capture is unavailable rather than creating a replacement artifact.

The managed API workflow does not inherit private storage configuration until App Storage is provisioned through the workspace storage setup flow; restart the API after provisioning so presigned upload requests can see `PRIVATE_OBJECT_DIR`.

**Why:** A reachable PostgreSQL server and healthy API process can still fail authenticated signup or upload checks when the schema or private object directory has not been initialized in the current workspace.

**How to apply:** Treat schema push and App Storage provisioning as separate runtime prerequisites, then verify `/api/healthz`, an authenticated upload request, and a restart persistence check.