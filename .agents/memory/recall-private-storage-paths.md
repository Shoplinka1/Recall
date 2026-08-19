---
name: Recall private storage paths
description: Non-obvious path convention for Recall's private object storage integration.
---

Recall stores logical upload paths as `/objects/uploads/<user-id>/<object-id>`. The configured private storage directory may include a provider-specific prefix such as `.private`; that prefix belongs only in signed storage requests, not in database paths or ownership checks.

**Why:** Including the private prefix in the logical path caused downloads to prepend it twice and caused valid uploads to fail ownership validation.

**How to apply:** Keep API/database paths relative to the private directory, validate the user-owned `uploads/<user-id>/` segment, and add the configured private prefix exactly once when signing PUT or GET URLs.