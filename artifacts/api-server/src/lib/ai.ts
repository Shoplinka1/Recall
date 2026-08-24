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
export type TeachingResult = {
  result: "correct" | "incorrect";
  explanation: string;
  keyIdea: string;
  misconception: string | null;
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
  analyzeMaterial(content: string): MaterialAnalysis | Promise<MaterialAnalysis>;
  extractConcepts(content: string): Concept[] | Promise<Concept[]>;
  generateQuestions(
    content: string,
    options?: { count?: number; excludeQuestionTexts?: string[] },
  ): Question[] | Promise<Question[]>;
  generateQuestionsFromSections(
    sections: GroundedSection[],
    concepts: GroundedConcept[],
    options?: { count?: number; excludeQuestionTexts?: string[] },
  ): GroundedQuestion[] | Promise<GroundedQuestion[]>;
  validateQuestions(questions: Question[]): Question[] | Promise<Question[]>;
  evaluateAnswer(question: Question, answer: AnswerInput): AnswerEvaluation | Promise<AnswerEvaluation>;
  teachAnswer(
    question: Question,
    answer: AnswerInput,
    isCorrect: boolean,
    recentFailures: number,
  ): TeachingResult | Promise<TeachingResult>;
  diagnoseWeaknesses(
    attempts: Array<{ question: Question; isCorrect: boolean; confidence: string }>,
  ): Weakness[] | Promise<Weakness[]>;
  generateTargetedPractice(
    content: string,
    weaknesses: Weakness[],
    excludeQuestionTexts?: string[],
  ): Question[] | Promise<Question[]>;
  generateExplanation(question: Question, answer: string): string | Promise<string>;
  generateRecommendation(weaknesses: Weakness[]): string | null | Promise<string | null>;
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

export const questionSimilarity = (left: string, right: string) => {
  const leftTokens = new Set(normalizeComparableText(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeComparableText(right).split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
};

const maskTerm = (sentence: string, term: string) => {
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return sentence.replace(new RegExp(escapedTerm, "i"), "_____");
};

const blankCount = (text: string) => (text.match(/_{5,}/g) ?? []).length;

const compactSource = (source: string, focus?: string, maxLength = 140) => {
  const candidate =
    source
      .split(/(?<=[.!?])\s+|\n+/)
      .map(clean)
      .find((sentence) => focus && sentence.toLowerCase().includes(focus.toLowerCase())) ??
    clean(source).split(/(?<=[.!?])\s+|\n+/)[0];
  if (candidate.length <= maxLength) return candidate;
  const focusIndex = focus ? candidate.toLowerCase().indexOf(focus.toLowerCase()) : 0;
  const start = Math.max(0, Math.min(focusIndex - 48, candidate.length - maxLength + 1));
  const prefix = start > 0 ? "… " : "";
  const available = maxLength - prefix.length;
  const clipped = candidate.slice(start, start + available).replace(/^\S*\s+/, "");
  return `${prefix}${clipped.trim()}${start + available < candidate.length ? " …" : ""}`;
};

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
    const excluded = (options.excludeQuestionTexts ?? []).map((value) => value.trim().toLowerCase());
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
      const sectionConcepts = concepts.filter((candidate) =>
        section.excerpt.toLowerCase().includes(candidate.name.toLowerCase()),
      );
      const coveredConcepts = sectionConcepts.length ? sectionConcepts : [concept];
      coveredConcepts.forEach((coveredConcept, conceptIndex) => {
        const focusedSource = compactSource(section.excerpt, coveredConcept.name);
        const maskedExcerpt = maskTerm(focusedSource, coveredConcept.name);
        if (blankCount(maskedExcerpt) !== 1) return;
        const base = {
          materialId: section.materialId,
          sectionId: section.id,
          concept: coveredConcept.name,
          difficulty: index % 3 === 0 ? "easy" : index % 3 === 1 ? "medium" : "hard",
          sourceExcerpt: section.excerpt,
          sourcePage: section.sectionIndex + 1,
          sourceSectionId: section.id,
          explanation: `The source section identifies “${coveredConcept.name}”: ${section.excerpt}`,
          correctAnswer: coveredConcept.name,
        };
        generated.push(
          {
            ...base,
            id: stableId(`${section.id}:definition:${coveredConcept.id}`, conceptIndex),
            questionText: `Complete the sentence: “${maskedExcerpt}”`,
            type: "short_answer",
            options: [],
          },
        );
      });
      generated.push({
        id: stableId(`${section.id}:true-false`, index),
        materialId: section.materialId,
        sectionId: section.id,
        questionText: `True or false: ${compactSource(section.excerpt)}`,
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
        const concept =
          concepts.find((candidate) =>
            section.excerpt.toLowerCase().includes(candidate.name.toLowerCase()),
          ) ?? concepts[index % Math.max(concepts.length, 1)];
        const distractors = concepts
          .filter((candidate) => candidate.id !== concept?.id)
          .map((candidate) => candidate.name)
          .slice(0, 3);
        if (!concept || distractors.length < 3) continue;
        const options = [concept.name, ...distractors];
        generated.push({
          id: stableId(`${section.id}:multiple-choice`, index),
          materialId: section.materialId,
          sectionId: section.id,
          questionText: "Which concept is central to this source section?",
          type: "multiple_choice",
          options,
          concept: concept.name,
          difficulty: "medium",
          sourceExcerpt: section.excerpt,
          sourcePage: section.sectionIndex + 1,
          sourceSectionId: section.id,
          explanation: `The selected statement is the source excerpt for this section: ${section.excerpt}`,
          correctAnswer: concept.name,
        });
      }
    }
    // `count` is a requested session size, not a cap on the useful question
    // bank. Generate the complete grounded candidate set so later practice
    // selection can choose a varied subset.
    void options.count;
    return this.validateGroundedQuestions(generated, sections, concepts)
      .filter(
        (question) =>
          !excluded.some(
            (previous) =>
              previous === question.questionText.trim().toLowerCase() ||
            questionSimilarity(previous, question.questionText) >= 0.8,
          ),
      );
  }

  validateGroundedQuestions(
    questions: GroundedQuestion[],
    sections: GroundedSection[],
    concepts: GroundedConcept[],
  ): GroundedQuestion[] {
    const seen: string[] = [];
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
      const validCloze =
        type !== "short_answer" || blankCount(question.questionText) === 1;
      const grounded =
        Boolean(section) &&
        question.materialId === section?.materialId &&
        Boolean(question.sourceExcerpt.trim()) &&
        normalizedSectionContent.includes(normalizedSourceExcerpt) &&
        (type === "multiple_choice"
          ? normalizedSectionContent.includes(question.correctAnswer.toLowerCase())
          : type === "true_false"
            ? questionSimilarity(question.questionText, question.sourceExcerpt) >= 0.35
            : question.sourceExcerpt.toLowerCase().includes(question.correctAnswer.toLowerCase()));
      const valid =
        validType &&
        validCloze &&
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
        !seen.some(
          (previous) =>
            previous === normalizedQuestion ||
            questionSimilarity(previous, normalizedQuestion) >= 0.8,
        );
      if (valid) seen.push(normalizedQuestion);
      return valid;
    });
  }

  private isAmbiguous(question: GroundedQuestion, type: string) {
    const text = question.questionText.trim().toLowerCase();
    if (type === "multiple_choice") {
      return !text.startsWith("which concept") || question.options.some((option) => option.trim().length < 3);
    }
    if (type === "true_false") {
      return !text.startsWith("true or false:") || text.length < 30;
    }
    return (
      !text.startsWith("complete the sentence:")
    ) || text.length < 20;
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
          ? question.options.some((option) => option.toLowerCase() === question.correctAnswer.trim().toLowerCase()) &&
            question.sourceExcerpt.toLowerCase().includes(question.correctAnswer.toLowerCase())
          : type === "true_false"
            ? questionSimilarity(question.questionText, question.sourceExcerpt) >= 0.35
            : question.sourceExcerpt.toLowerCase().includes(question.correctAnswer.toLowerCase()));
      if (valid) seen.add(key);
      return valid;
    });
  }

  evaluateAnswer(question: Question, answer: AnswerInput): AnswerEvaluation {
    const isCorrect = answersMatch(question.correctAnswer, answer.answer, question.type);
    return { isCorrect, concept: question.concept, explanation: this.generateExplanation(question, answer.answer) };
  }

  teachAnswer(
    question: Question,
    answer: AnswerInput,
    isCorrect: boolean,
    recentFailures: number,
  ): TeachingResult {
    const keyIdea = question.sourceExcerpt.trim();
    if (isCorrect) {
      return {
        result: "correct",
        explanation:
          answer.confidence === "low"
            ? `Your answer matches the source. ${question.explanation}`
            : question.explanation,
        keyIdea,
        misconception: null,
      };
    }

    const submitted = answer.answer.trim();
    const expected = question.correctAnswer.trim();
    const source = question.sourceExcerpt.trim();
    const sourceIncludesSubmitted =
      submitted.length >= 3 && normalizeComparableText(source).includes(normalizeComparableText(submitted));
    const misconception =
      sourceIncludesSubmitted && normalizeShortAnswer(submitted) !== normalizeShortAnswer(expected)
        ? `You may be mixing “${submitted}” with “${expected}”. The source distinguishes them here.`
        : null;
    const scaffold =
      recentFailures >= 2
        ? `Start with the key distinction: the answer supported by this source is “${expected}”.`
        : `The source supports “${expected}”, not “${submitted || "an empty answer"}”.`;
    return {
      result: "incorrect",
      explanation: `${scaffold} ${question.explanation}`,
      keyIdea,
      misconception,
    };
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

class RealGeminiAIService implements AIService {
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new AIConfigurationError("AI_MODE=real requires GEMINI_API_KEY.");
    this.apiKey = apiKey;
    this.model = process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";
  }

  private async ask<T>(instruction: string): Promise<T> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: instruction }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!response.ok) throw new AIConfigurationError(`Gemini request failed (${response.status}).`);
    const body = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    if (!text) throw new Error("Gemini returned no content.");
    try {
      return JSON.parse(text.replace(/^```json\s*/i, "").replace(/\s*```$/, "")) as T;
    } catch {
      throw new Error("Gemini returned invalid JSON.");
    }
  }

  async analyzeMaterial(content: string) {
    return this.ask<MaterialAnalysis>(`Analyze only this study material. Return JSON with summary and sections (each section has title, excerpt, and sourcePage). Do not add facts not present.
MATERIAL:
${content}`);
  }

  async extractConcepts(content: string) {
    const result = await this.ask<{ concepts: Concept[] }>(`Extract the important concepts from this material. Return JSON {"concepts":[{"name":string,"description":string,"excerpt":string}]}. Every excerpt must be copied from the material.
MATERIAL:
${content}`);
    return result.concepts ?? [];
  }

  async generateQuestions(content: string, options: { count?: number; excludeQuestionTexts?: string[] } = {}) {
    const result = await this.ask<{ questions: Question[] }>(`Create ${options.count ?? 6} grounded questions from this material. Return JSON {"questions":[Question]}; use short_answer, multiple_choice, or true_false; every sourceExcerpt, explanation, and correctAnswer must be supported by the material. Avoid these question texts: ${JSON.stringify(options.excludeQuestionTexts ?? [])}.
MATERIAL:
${content}`);
    return new DevelopmentAIService().validateQuestions(result.questions ?? []);
  }

  async generateQuestionsFromSections(
    sections: GroundedSection[],
    concepts: GroundedConcept[],
    options: { count?: number; excludeQuestionTexts?: string[] } = {},
  ) {
    const result = await this.ask<{ questions: GroundedQuestion[] }>(`Create ${options.count ?? 6} grounded questions using only the supplied sections and concepts. Return JSON {"questions":[Question]}. Each question must include the supplied sectionId and materialId, and sourceExcerpt must be copied exactly from its section. Avoid these question texts: ${JSON.stringify(options.excludeQuestionTexts ?? [])}.
SECTIONS:
${JSON.stringify(sections)}
CONCEPTS:
${JSON.stringify(concepts)}`);
    return result.questions
      ? (new DevelopmentAIService().validateQuestions(result.questions) as Array<
          Question & Partial<Pick<GroundedQuestion, "sectionId" | "materialId">>
        >).filter(
          (question): question is GroundedQuestion =>
            typeof question.sectionId === "string" &&
            typeof question.materialId === "string" &&
            sections.some((section) => section.id === question.sectionId) &&
            sections.some((section) => section.materialId === question.materialId),
        )
      : [];
  }

  validateQuestions(questions: Question[]) {
    return new DevelopmentAIService().validateQuestions(questions);
  }

  async evaluateAnswer(question: Question, answer: AnswerInput) {
    return this.ask<AnswerEvaluation>(`Evaluate the learner answer against the grounded question. Return JSON with isCorrect, explanation, and concept. Do not change the concept.
QUESTION:
${JSON.stringify(question)}
ANSWER:
${JSON.stringify(answer)}`);
  }

  async teachAnswer(question: Question, answer: AnswerInput, isCorrect: boolean, recentFailures: number) {
    return this.ask<TeachingResult>(`Teach this learner from the grounded question and answer. Return JSON with result ("correct" or "incorrect"), explanation, keyIdea, and misconception (string or null). Do not add facts beyond the question source.
QUESTION:
${JSON.stringify(question)}
ANSWER:
${JSON.stringify(answer)}
IS_CORRECT: ${isCorrect}
RECENT_FAILURES: ${recentFailures}`);
  }

  async diagnoseWeaknesses(attempts: Array<{ question: Question; isCorrect: boolean; confidence: string }>) {
    const result = await this.ask<{ weaknesses: Weakness[] }>(`Diagnose learning weaknesses from these grounded attempts. Return JSON {"weaknesses":[{"concept":string,"reason":string,"severity":"low"|"medium"|"high"}]}.
ATTEMPTS:
${JSON.stringify(attempts)}`);
    return result.weaknesses ?? [];
  }

  async generateTargetedPractice(content: string, weaknesses: Weakness[], excludeQuestionTexts: string[] = []) {
    return this.generateQuestions(`${content}\nFocus on these weaknesses: ${JSON.stringify(weaknesses)}`, {
      count: 6,
      excludeQuestionTexts,
    });
  }

  async generateExplanation(question: Question, answer: string) {
    const result = await this.ask<{ explanation: string }>(`Explain the answer using only the question's source excerpt. Return JSON {"explanation":string}.
QUESTION:
${JSON.stringify(question)}
LEARNER ANSWER:
${answer}`);
    return result.explanation;
  }

  async generateRecommendation(weaknesses: Weakness[]) {
    if (!weaknesses.length) return null;
    const result = await this.ask<{ recommendation: string }>(`Recommend one focused study action for these weaknesses. Return JSON {"recommendation":string}.
WEAKNESSES:
${JSON.stringify(weaknesses)}`);
    return result.recommendation ?? null;
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
  teachAnswer(): never { return this.fail(); }
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
  if (provider === "gemini") return new RealGeminiAIService();
  return new RealAIServiceUnavailable(provider);
};

export const generateGroundedQuestions = (questions: Question[], count: number): Question[] =>
  new DevelopmentAIService().validateQuestions(questions).slice(0, Math.max(1, Math.min(count, questions.length)));