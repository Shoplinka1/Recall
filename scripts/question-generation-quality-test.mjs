import assert from "node:assert/strict";
import { DevelopmentAIService } from "../artifacts/api-server/src/lib/ai.ts";

const ai = new DevelopmentAIService();
const contents = [
  "Photosynthesis converts light energy into chemical energy in plant cells.",
  "Chlorophyll absorbs light in the chloroplast and starts the reaction.",
  "Carbon dioxide and water are used to produce glucose and oxygen.",
  "The Calvin cycle uses ATP and NADPH to build sugar molecules.",
  "Cellular respiration transfers energy through mitochondria and produces ATP.",
  "Enzymes lower activation energy and regulate metabolic reactions.",
];
const sections = contents.map((content, sectionIndex) => ({
  id: `quality-section-${sectionIndex}`,
  materialId: "quality-material",
  sectionIndex,
  content,
}));
const concepts = [
  "Photosynthesis",
  "Chlorophyll",
  "Carbon dioxide",
  "Calvin cycle",
  "Mitochondria",
  "Enzymes",
].map((name, index) => ({ id: `quality-concept-${index}`, name }));

const questions = ai.generateQuestionsFromSections(sections, concepts, { count: 2 });
assert.ok(questions.length > 2, "substantial material should produce more than two questions");
assert.equal(new Set(questions.map((question) => question.concept)).size, concepts.length, "questions should cover distinct concepts");
assert.equal(new Set(questions.map((question) => question.sectionId)).size, sections.length, "questions should cover distinct sections");
assert.deepEqual(
  [...new Set(questions.map((question) => question.type))].sort(),
  ["multiple_choice", "short_answer", "true_false"],
  "questions should vary supported forms",
);
assert.ok(
  questions.every(
    (question) =>
      question.materialId === "quality-material" &&
      sections.some((section) => section.id === question.sectionId) &&
      question.sourceExcerpt.length >= 20,
  ),
  "every question should retain valid material and section provenance",
);

const first = questions[0];
assert.equal(
  ai.validateGroundedQuestions(
    [first, { ...first, id: "quality-near-duplicate", questionText: first.questionText.replace("key concept", "important concept") }],
    sections,
    concepts,
  ).length,
  1,
  "near-duplicate questions should be rejected",
);
assert.equal(
  ai.validateGroundedQuestions(
    [{ ...first, id: "quality-unsupported-answer", correctAnswer: "unsupported answer" }],
    sections,
    concepts,
  ).length,
  0,
  "unsupported answers should be rejected",
);

const mcq = questions.find((question) => question.type === "multiple_choice");
assert.ok(mcq && mcq.options.length === 4 && mcq.options.includes(mcq.correctAnswer), "MCQ options should remain valid");
const trueFalse = questions.find((question) => question.type === "true_false");
assert.ok(trueFalse && trueFalse.correctAnswer === "True", "true/false should remain grounded");
const shortAnswer = questions.find((question) => question.type === "short_answer");
assert.ok(shortAnswer && !shortAnswer.questionText.includes(shortAnswer.correctAnswer), "short-answer prompts should not reveal their answers");

console.log("Question-generation quality tests passed.", {
  questions: questions.length,
  concepts: new Set(questions.map((question) => question.concept)).size,
  sections: new Set(questions.map((question) => question.sectionId)).size,
});