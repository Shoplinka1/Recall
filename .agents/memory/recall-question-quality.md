---
name: Recall question quality
description: Durable constraints for concise grounded question generation.
---

Question prompts should use a compact source sentence rather than copying a full section; cloze questions should have one focused blank, and MCQ options should be concise persisted concepts.

**Why:** Long source excerpts are difficult to scan on mobile and turn retrieval practice into rereading. Compact prompts preserve grounding while testing the intended concept.

**How to apply:** Keep the complete excerpt in provenance and explanations, but derive prompts from the sentence containing the target concept. Validate prompt length, source overlap, answer grounding, and option uniqueness.