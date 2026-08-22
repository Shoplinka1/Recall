export type MasteryAttempt = {
  isCorrect: boolean | null;
  confidence: string | null;
  responseTimeMs?: number | null;
  difficulty: string;
  type: string;
  createdAt: Date;
};

const difficultyWeight: Record<string, number> = {
  easy: 1,
  medium: 1.12,
  hard: 1.25,
};

const confidenceWeight: Record<string, number> = {
  low: 0.8,
  medium: 1,
  high: 1.15,
};

const confidenceScore: Record<string, number> = {
  low: 33,
  medium: 67,
  high: 100,
};

export function calculateMisconceptionSignal(attempts: MasteryAttempt[]): number {
  const mistakes = attempts.filter((attempt) => attempt.isCorrect === false);
  return Math.min(
    1,
    mistakes.reduce((sum, attempt) => sum + (confidenceWeight[attempt.confidence?.toLowerCase() ?? ""] ?? 1), 0) / 3,
  );
}

/**
 * Deliberately rewards repeated, recent, varied retrieval instead of treating
 * one correct answer as mastery. This is pure so the scoring contract is easy
 * to regression-test and remains independent of AI interpretation.
 */
export function calculateMasteryScore(attempts: MasteryAttempt[], now = Date.now()): number {
  if (attempts.length === 0) return 0;

  // Attempt history is commonly returned newest-first. Normalize it before
  // selecting the recent window so position and recency always agree.
  const recent = [...attempts]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(-12);
  let weightedTotal = 0;
  let weightedCorrect = 0;
  recent.forEach((attempt, index) => {
    const ageDays = Math.max(0, (now - attempt.createdAt.getTime()) / 86_400_000);
    const recency = Math.max(0.55, 1 - ageDays / 60);
    const position = 0.85 + ((index + 1) / recent.length) * 0.15;
    const weight =
      recency *
      position *
      (difficultyWeight[attempt.difficulty.toLowerCase()] ?? 1) *
      (confidenceWeight[attempt.confidence?.toLowerCase() ?? ""] ?? 1);
    weightedTotal += weight;
    if (attempt.isCorrect) weightedCorrect += weight;
  });

  const accuracy = weightedTotal ? weightedCorrect / weightedTotal : 0;
  const repeatedSuccess = Math.min(1, recent.filter((attempt) => attempt.isCorrect).length / 4);
  const repeatedMistakes = Math.min(1, recent.filter((attempt) => attempt.isCorrect === false).length / 3);
  const misconceptionSignal = calculateMisconceptionSignal(recent);
  const diversity = Math.min(
    1,
    new Set(recent.map((attempt) => `${attempt.type}:${attempt.difficulty}`)).size / 4,
  );
  const score =
    accuracy * 68 +
    repeatedSuccess * 17 +
    diversity * 10 -
    repeatedMistakes * 15 -
    misconceptionSignal * 8;

  // A single success must never make a concept look mastered.
  const experienceCap = attempts.length === 1 ? 45 : attempts.length === 2 ? 65 : 100;
  return Math.round(Math.max(0, Math.min(experienceCap, score)));
}

export function averageConfidence(attempts: MasteryAttempt[]): number {
  const values = attempts
    .map((attempt) => confidenceScore[attempt.confidence?.toLowerCase() ?? ""])
    .filter((value): value is number => value !== undefined);
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}