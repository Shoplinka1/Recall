import assert from "node:assert/strict";
import { averageConfidence, calculateMasteryScore, calculateMisconceptionSignal } from "../artifacts/api-server/src/lib/mastery.ts";

const now = Date.now();
const attempt = (isCorrect, confidence, difficulty = "medium", daysAgo = 0) => ({
  isCorrect,
  confidence,
  difficulty,
  type: "multiple_choice",
  createdAt: new Date(now - daysAgo * 86_400_000),
});

assert.ok(calculateMasteryScore([attempt(true, "high")], now) < 80, "one answer cannot create mastery");
assert.ok(
  calculateMasteryScore(
    [attempt(true, "high"), attempt(true, "high"), attempt(true, "medium"), attempt(true, "high")],
    now,
  ) > calculateMasteryScore([attempt(true, "low"), attempt(false, "high"), attempt(false, "high")], now),
  "repeated success should beat repeated mistakes",
);
assert.equal(
  calculateMasteryScore(
    [attempt(true, "high", "medium", 0), attempt(false, "high", "medium", 10)],
    now,
  ),
  calculateMasteryScore(
    [attempt(false, "high", "medium", 10), attempt(true, "high", "medium", 0)],
    now,
  ),
  "mastery should be independent of newest-first versus oldest-first history",
);
assert.ok(
  calculateMisconceptionSignal([attempt(false, "high"), attempt(false, "high")]) >
    calculateMisconceptionSignal([attempt(false, "low"), attempt(false, "low")]),
  "high-confidence mistakes should be a stronger weakness signal",
);
assert.equal(averageConfidence([attempt(true, "low"), attempt(true, "high")]), 67);
console.log("Step 6 mastery tests passed");