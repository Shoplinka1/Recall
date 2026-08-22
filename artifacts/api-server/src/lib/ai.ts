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
export type GroundedSection = {
  id: string;
  materialId: string;
  sectionIndex: number;
  content: string;
};
export type GroundedConcept = { id: string; name: string };
export type GroundedQuestion = Question & { sectionId: string; materialId: string };

export interface AIService {
  analyzeMaterial(content: string): MaterialAnalysis;
  extractConcepts(content: string): Concept[];
  generateQuestions(
    content: string,
    options?: { count?: number; excludeQuestionTexts?: string[] },
  ): Question[];
  generateQuestionsFromSections(
    sections: GroundedSection[],
    concepts: GroundedConcept[],
    options?: { count?: number; excludeQuestionTexts?: string[] },
  ): GroundedQuestion[];
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

const terminologyAliases: Array<[RegExp, string]> = [
  [/\bcarbon dioxide\b|\bco2\b/g, "carbon dioxide"],
  [/\bwater\b|\bh2o\b/g, "water"],
  [/\boxygen\b|\bo2\b/g, "oxygen"],
  [/\bglucose\b|\bdextrose\b/g, "glucose"],
  [/\badenosine triphosphate\b|\batp\b/g, "adenosine triphosphate"],
  [/\bnicotinamide adenine dinucleotide phosphate\b|\bnadph\b/g, "nadph"],
];

const normalizeComparableText = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeShortAnswer = (value: string) => {
  let normalized = normalizeComparableText(value);
  for (const [pattern, replacement] of terminologyAliases) {
    normalized = normalized.replace(pattern, replacement);
  }
  normalized = normalized
    .replace(/^(the answer is|the term is|it is|this is)\s+/, "")
    .replace(/^the process of\s+/, "")
    .replace(/^(the|a|an)\s+/, "")
    .replace(/\s+(process|term|molecule|compound|element|gas)$/, "")
    .trim();
  const words = normalized.split(" ").filter(Boolean).map((word) => {
    if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
    if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) return word.slice(0, -1);
    return word;
  });
  return words.join(" ");
};

/**
 * Match a submitted answer against the answer stored with the question.
 * Short-answer flexibility is deliberately bounded to terminology and
 * grammatical variants; extra content is not ignored.
 */
export const answersMatch = (
  expected: string,
  submitted: string,
  type: Question["type"] = "short_answer",
) => {
  if (type !== "short_answer") {
    return normalizeComparableText(expected) === normalizeComparableText(submitted);
  }
  return normalizeShortAnswer(expected) === normalizeShortAnswer(submitted);
};

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
        sourceSectionId: null,
        explanation: `The material states: ${excerpt}`,
        correctAnswer: answer,
      };
      return excluded.has(questionText) ? [] : [question];
    });
    return this.validateQuestions(generated).slice(0, Math.max(1, Math.min(options.count ?? 6, 20)));
  }

  generateQuestionsFromSections(
    sections: GroundedSection[],
    concepts: GroundedConcept[],
    options: { count?: number; excludeQuestionTexts?: string[] } = {},
  ): GroundedQuestion[] {
    const excluded = new Set(
      (options.excludeQuestionTexts ?? []).map((value) => value.trim().toLowerCase()),
    );
    const usable = sections
      .map((section) => ({
        ...section,
        excerpt: clean(section.content),
      }))
      .filter((section) => section.excerpt.length >= 30);
    const generated: GroundedQuestion[] = [];
    for (const [index, section] of usable.entries()) {
      const concept =
        concepts.find((candidate) =>
          section.excerpt.toLowerCase().includes(candidate.name.toLowerCase()),
        ) ?? concepts[index % Math.max(concepts.length, 1)];
      if (!concept) continue;
      const terms = termsFrom(section.excerpt);
      const shortAnswer = terms[0];
      if (shortAnswer) {
        generated.push({
          id: stableId(`${section.id}:short`, index),
          materialId: section.materialId,
          sectionId: section.id,
          questionText: `Which key term is named in this source section about ${concept.name}?`,
          type: "short_answer",
          options: [],
          concept: concept.name,
          difficulty: index % 3 === 0 ? "easy" : index % 3 === 1 ? "medium" : "hard",
          sourceExcerpt: section.excerpt,
          sourcePage: section.sectionIndex + 1,
          sourceSectionId: section.id,
          explanation: `The source section names “${shortAnswer}”: ${section.excerpt}`,
          correctAnswer: shortAnswer,
        });
      }
      generated.push({
        id: stableId(`${section.id}:true-false`, index),
          materialId: section.materialId,
        sectionId: section.id,
        questionText: `True or false: ${section.excerpt}`,
        type: "true_false",
        options: ["True", "False"],
        concept: concept.name,
        difficulty: "medium",
        sourceExcerpt: section.excerpt,
        sourcePage: section.sectionIndex + 1,
        sourceSectionId: section.id,
        explanation: `This statement is taken directly from the source section: ${section.excerpt}`,
        correctAnswer: "True",
      });
    }
    if (usable.length >= 4) {
      for (const [index, section] of usable.entries()) {
        const options = usable
          .slice(Math.floor(index / 4) * 4, Math.floor(index / 4) * 4 + 4)
          .map((candidate) => candidate.excerpt);
        if (options.length !== 4) break;
        const concept =
          concepts.find((candidate) =>
            section.excerpt.toLowerCase().includes(candidate.name.toLowerCase()),
          ) ?? concepts[index % Math.max(concepts.length, 1)];
        if (!concept) continue;
        generated.push({
          id: stableId(`${section.id}:multiple-choice`, index),
          materialId: section.materialId,
          sectionId: section.id,
          questionText: "Which statement is taken from this source section?",
          type: "multiple_choice",
          options,
          concept: concept.name,
          difficulty: "medium",
          sourceExcerpt: section.excerpt,
          sourcePage: section.sectionIndex + 1,
          sourceSectionId: section.id,
          explanation: `The selected statement is the source excerpt for this section: ${section.excerpt}`,
          correctAnswer: section.excerpt,
        });
      }
    }
    return this.validateGroundedQuestions(generated, sections, concepts)
      .filter((question) => !excluded.has(question.questionText.trim().toLowerCase()))
      .slice(0, Math.max(1, Math.min(options.count ?? 6, 20)));
  }

  validateGroundedQuestions(
    questions: GroundedQuestion[],
    sections: GroundedSection[],
    concepts: GroundedConcept[],
  ): GroundedQuestion[] {
    const seen = new Set<string>();
    const sectionMap = new Map(sections.map((section) => [section.id, section]));
    const conceptNames = new Set(concepts.map((concept) => concept.name.toLowerCase()));
    return questions.filter((question) => {
      const type = question.type.toLowerCase();
      const options = question.options.map((option) => option.trim()).filter(Boolean);
      const section = sectionMap.get(question.sectionId);
      const normalizedQuestion = question.questionText.trim().toLowerCase();
      const difficulty = question.difficulty.toLowerCase();
      const normalizedSectionContent = section ? clean(section.content).toLowerCase() : "";
      const normalizedSourceExcerpt = question.sourceExcerpt.trim().toLowerCase();
      const validType = ["multiple_choice", "true_false", "short_answer"].includes(type);
      const validOptions =
        type === "multiple_choice"
          ? options.length === 4 &&
            new Set(options.map((option) => option.toLowerCase())).size === 4 &&
            options.filter(
              (option) => option.toLowerCase() === question.correctAnswer.trim().toLowerCase(),
            ).length === 1
          : type === "true_false"
            ? options.length === 2 &&
              options.map((option) => option.toLowerCase()).join("|") === "true|false" &&
              ["true", "false"].includes(question.correctAnswer.trim().toLowerCase())
            : options.length === 0;
      const grounded =
        Boolean(section) &&
        question.materialId === section?.materialId &&
        Boolean(question.sourceExcerpt.trim()) &&
        normalizedSectionContent.includes(normalizedSourceExcerpt) &&
        (type === "multiple_choice"
          ? question.correctAnswer === question.sourceExcerpt
          : type === "true_false"
            ? question.questionText.toLowerCase().includes(question.sourceExcerpt.toLowerCase())
            : question.sourceExcerpt.toLowerCase().includes(question.correctAnswer.toLowerCase()));
      const valid =
        validType &&
        ["easy", "medium", "hard"].includes(difficulty) &&
        validOptions &&
        Boolean(normalizedQuestion) &&
        question.questionText.trim().length >= 12 &&
        question.correctAnswer.trim().length > 0 &&
        question.explanation.trim().length > 0 &&
        question.explanation.toLowerCase().includes(question.sourceExcerpt.toLowerCase()) &&
        conceptNames.has(question.concept.toLowerCase()) &&
        question.concept.trim().length >= 2 &&
        grounded &&
        !this.isAmbiguous(question, type) &&
        !seen.has(normalizedQuestion);
      if (valid) seen.add(normalizedQuestion);
      return valid;
    });
  }

  private isAmbiguous(question: GroundedQuestion, type: string) {
    const text = question.questionText.trim().toLowerCase();
    if (type === "multiple_choice") {
      return !text.includes("which") || question.options.some((option) => option.trim().length < 3);
    }
    if (type === "true_false") {
      return !text.startsWith("true or false:") || text.length < 30;
    }
    return !text.includes("key term") || text.length < 20;
  }

  validateQuestions(questions: Question[]): Question[] {
    const seen = new Set<string>();
    return questions.filter((question) => {
      const key = question.questionText.trim().toLowerCase();
      const type = question.type.trim().toLowerCase();
      const options = question.options.map((option) => option.trim()).filter(Boolean);
      const validType = ["multiple_choice", "true_false", "short_answer"].includes(type);
      const validOptions =
        type === "multiple_choice"
          ? options.length === 4 &&
            new Set(options.map((option) => option.toLowerCase())).size === 4 &&
            options.filter((option) => option.toLowerCase() === question.correctAnswer.trim().toLowerCase()).length === 1
          : type === "true_false"
            ? options.length === 2 &&
              options.map((option) => option.toLowerCase()).join("|") === "true|false" &&
              ["true", "false"].includes(question.correctAnswer.trim().toLowerCase())
            : options.length === 0;
      const valid =
        validType &&
        validOptions &&
        ["easy", "medium", "hard"].includes(question.difficulty.trim().toLowerCase()) &&
        Boolean(key) &&
        !seen.has(key) &&
        question.sourceExcerpt.trim().length >= 20 &&
        question.questionText.trim().length >= 12 &&
        question.correctAnswer.trim().length > 0 &&
        question.explanation.trim().length > 0 &&
        question.explanation.toLowerCase().includes(question.sourceExcerpt.toLowerCase()) &&
        (type === "multiple_choice"
          ? question.options.some((option) => option.toLowerCase() === question.correctAnswer.trim().toLowerCase())
          : type === "true_false"
            ? question.questionText.toLowerCase().includes(question.sourceExcerpt.toLowerCase())
            : question.sourceExcerpt.toLowerCase().includes(question.correctAnswer.toLowerCase()));
      if (valid) seen.add(key);
      return valid;
    });
  }

  evaluateAnswer(question: Question, answer: AnswerInput): AnswerEvaluation {
    const isCorrect = answersMatch(question.correctAnswer, answer.answer, question.type);
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
  generateQuestionsFromSections(): never { return this.fail(); }
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