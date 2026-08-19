import type { AnswerInput, Question } from "@workspace/api-zod";

export type AIProvider = "gemini" | "openai" | "anthropic";
export type MaterialAnalysis = {
  summary: string;
  sections: Array<{ title: string; excerpt: string; sourcePage?: number }>;
};
export type Concept = { name: string; description: string; excerpt: string };
export type AnswerEvaluation = {
  isCorrect: boolean;
  explanation: string;
  concept: string;
};
export type Weakness = {
  concept: string;
  reason: string;
  severity: "low" | "medium" | "high";
};

export interface AIService {
  analyzeMaterial(content: string): MaterialAnalysis;
  extractConcepts(content: string): Concept[];
  generateQuestions(
    content: string,
    options?: { count?: number; excludeQuestionTexts?: string[] },
  ): Question[];
  validateQuestions(questions: Question[]): Question[];
  evaluateAnswer(question: Question, answer: AnswerInput): AnswerEvaluation;
  diagnoseWeaknesses(
    attempts: Array<{ question: Question; isCorrect: boolean; confidence: string }>,
  ): Weakness[];
  generateTargetedPractice(
    content: string,
    weaknesses: Weakness[],
    excludeQuestionTexts?: string[],
  ): Question[];
  generateExplanation(question: Question, answer: string): string;
  generateRecommendation(weaknesses: Weakness[]): string | null;
}

const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const sentences = (content: string) =>
  content
    .split(/(?<=[.!?])\s+|\n+/)
    .map(clean)
    .filter((sentence) => sentence.length >= 30);

const termsFrom = (sentence: string) =>
  Array.from(
    new Set(
      sentence
        .replace(/[^A-Za-z0-9\s-]/g, "")
        .split(/\s+/)
        .filter((word) => word.length >= 6)
        .map((word) => word.toLowerCase()),
    ),
  );

function stableId(value: string, index: number) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `dev-question-${Math.abs(hash >>> 0).toString(36)}-${index}`;
}

/**
 * A cost-free provider that derives every output from the supplied material.
 * It is deliberately synchronous and deterministic so it can be used in local
 * development and tests without ever contacting an external AI service.
 */
export class DevelopmentAIService implements AIService {
  analyzeMaterial(content: string): MaterialAnalysis {
    const sections = sentences(content).slice(0, 12).map((excerpt, index) => ({
      title: `Section ${index + 1}`,
      excerpt,
      sourcePage: index + 1,
    }));
    return {
      summary: sections.length
        ? sections.slice(0, 3).map((section) => section.excerpt).join(" ")
        : "The material does not contain enough text to analyze.",
      sections,
    };
  }

  extractConcepts(content: string): Concept[] {
    return sentences(content)
      .flatMap(termsFrom)
      .reduce<Concept[]>((concepts, term) => {
        if (concepts.some((concept) => concept.name.toLowerCase() === term)) return concepts;
        const excerpt = sentences(content).find((sentence) =>
          sentence.toLowerCase().includes(term),
        );
        if (excerpt) concepts.push({ name: term[0].toUpperCase() + term.slice(1), description: excerpt, excerpt });
        return concepts;
      }, [])
      .slice(0, 12);
  }

  generateQuestions(
    content: string,
    options: { count?: number; excludeQuestionTexts?: string[] } = {},
  ): Question[] {
    const excluded = new Set(options.excludeQuestionTexts ?? []);
    const materialSentences = sentences(content);
    const concepts = this.extractConcepts(content);
    const generated = materialSentences.flatMap((excerpt, index) => {
      const concept = concepts[index % Math.max(concepts.length, 1)]?.name ?? "Core idea";
      const terms = termsFrom(excerpt);
      const answer = terms[0] ?? excerpt.split(" ")[0];
      if (!answer || excerpt.length < 30) return [];
      const questionText = `Which statement is supported by this material about ${concept}?`;
      const question: Question = {
        id: stableId(excerpt, index),
        questionText,
        type: "short_answer",
        options: [],
        concept,
        difficulty: index % 3 === 0 ? "easy" : index % 3 === 1 ? "medium" : "hard",
        sourceExcerpt: excerpt,
        sourcePage: index + 1,
        explanation: `The material states: ${excerpt}`,
        correctAnswer: answer,
      };
      return excluded.has(questionText) ? [] : [question];
    });
    return this.validateQuestions(generated).slice(0, Math.max(1, Math.min(options.count ?? 6, 20)));
  }

  validateQuestions(questions: Question[]): Question[] {
    const seen = new Set<string>();
    return questions.filter((question) => {
      const key = question.questionText.trim().toLowerCase();
      const valid =
        Boolean(key) &&
        !seen.has(key) &&
        question.sourceExcerpt.trim().length >= 20 &&
        question.questionText.trim().length >= 12 &&
        question.correctAnswer.trim().length > 0 &&
        question.explanation.trim().length > 0 &&
        question.sourceExcerpt.toLowerCase().includes(question.correctAnswer.toLowerCase());
      if (valid) seen.add(key);
      return valid;
    });
  }

  evaluateAnswer(question: Question, answer: AnswerInput): AnswerEvaluation {
    const isCorrect = question.correctAnswer.trim().toLowerCase() === answer.answer.trim().toLowerCase();
    return { isCorrect, concept: question.concept, explanation: this.generateExplanation(question, answer.answer) };
  }

  diagnoseWeaknesses(
    attempts: Array<{ question: Question; isCorrect: boolean; confidence: string }>,
  ): Weakness[] {
    const grouped = new Map<string, typeof attempts>();
    for (const attempt of attempts) grouped.set(attempt.question.concept, [...(grouped.get(attempt.question.concept) ?? []), attempt]);
    return [...grouped.entries()]
      .map(([concept, values]) => {
        const mistakes = values.filter((value) => !value.isCorrect).length;
        const confidentMistakes = values.filter((value) => !value.isCorrect && value.confidence === "Very sure").length;
        const severity: Weakness["severity"] =
          confidentMistakes > 0 || mistakes >= 3 ? "high" : mistakes > 0 ? "medium" : "low";
        return { concept, severity, reason: `${mistakes} of ${values.length} recent answers were incorrect${confidentMistakes ? `, including ${confidentMistakes} high-confidence mistake${confidentMistakes === 1 ? "" : "s"}` : ""}.` };
      })
      .filter((weakness) => weakness.severity !== "low");
  }

  generateTargetedPractice(content: string, weaknesses: Weakness[], excludeQuestionTexts: string[] = []) {
    const focus = weaknesses.map((weakness) => weakness.concept.toLowerCase());
    const focusedContent = sentences(content)
      .filter((sentence) => focus.some((term) => sentence.toLowerCase().includes(term)))
      .join(" ");
    return this.generateQuestions(focusedContent || content, { count: 6, excludeQuestionTexts });
  }

  generateExplanation(question: Question, answer: string) {
    return answer.trim()
      ? `${question.explanation} Your answer was “${answer.trim()}”.`
      : question.explanation;
  }

  generateRecommendation(weaknesses: Weakness[]) {
    const weakness = weaknesses[0];
    return weakness ? `Practice ${weakness.concept}: ${weakness.reason}` : null;
  }
}

export class AIConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIConfigurationError";
  }
}

class RealAIServiceUnavailable implements AIService {
  constructor(private readonly provider: AIProvider) {}
  private fail(): never {
    const key = `${this.provider.toUpperCase()}_API_KEY`;
    throw new AIConfigurationError(
      `AI_MODE=real requires a configured ${this.provider} provider. Set ${key} on the server or use AI_MODE=development.`,
    );
  }
  analyzeMaterial(): never { return this.fail(); }
  extractConcepts(): never { return this.fail(); }
  generateQuestions(): never { return this.fail(); }
  validateQuestions(): never { return this.fail(); }
  evaluateAnswer(): never { return this.fail(); }
  diagnoseWeaknesses(): never { return this.fail(); }
  generateTargetedPractice(): never { return this.fail(); }
  generateExplanation(): never { return this.fail(); }
  generateRecommendation(): never { return this.fail(); }
}

export const getAIProvider = (): string => process.env.AI_PROVIDER?.trim() || "gemini";

export const getAIService = (): AIService => {
  if ((process.env.AI_MODE ?? "development").toLowerCase() === "development") {
    return new DevelopmentAIService();
  }
  const provider = getAIProvider().toLowerCase() as AIProvider;
  if (!["gemini", "openai", "anthropic"].includes(provider)) {
    throw new AIConfigurationError(`Unsupported AI_PROVIDER "${provider}". Use gemini, openai, or anthropic.`);
  }
  return new RealAIServiceUnavailable(provider);
};

export const generateGroundedQuestions = (questions: Question[], count: number): Question[] =>
  new DevelopmentAIService().validateQuestions(questions).slice(0, Math.max(1, Math.min(count, questions.length)));