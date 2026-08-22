---
name: Recall verification contracts
description: Verification probes must follow the current generated API contract rather than stale step-script payloads.
---

When validating persistence or ownership, build probes from the current OpenAPI-generated request schema and explicitly complete practice sessions before asserting completed-result restoration.

**Why:** Imported step scripts can lag behind the live contract, and practice completion is an explicit API transition rather than an automatic side effect of answering the final question.

**How to apply:** Inspect the current generated Zod/OpenAPI schema before writing a probe, and verify both in-progress restore and post-completion restore across an API restart.