import type { Question } from "@workspace/api-zod";

export const getAIProvider = (): string =>
  process.env.AI_PROVIDER?.trim() || "demo";

export const generateGroundedQuestions = (
  questions: Question[],
  count: number,
): Question[] => {
  // The demo provider is deliberately grounded in stored source excerpts.
  // A configured provider can replace this function without changing routes.
  return questions
    .slice(0, Math.max(1, Math.min(count, questions.length)))
    .map((question) => ({ ...question }));
};