---
name: Recall answer evaluation
description: The safe boundary for flexible short-answer scoring.
---

Short-answer scoring may accept grounded terminology aliases, singular/plural variants, capitalization, spacing, articles, and limited answer framing, but must reject answers with extra unrelated content. Multiple-choice and true/false scoring should remain exact after basic text normalization.

**Why:** Exact string matching penalizes legitimate scientific answers, while broad token-overlap matching can mark unrelated answers correct.

**How to apply:** Keep flexibility type-specific and conservative. Extend the explicit alias set only when the equivalence is unambiguous and grounded in the persisted question/material context.