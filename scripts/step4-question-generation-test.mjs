import assert from "node:assert/strict";
import { DevelopmentAIService } from "../artifacts/api-server/src/lib/ai.ts";

const baseUrl = process.env.STEP4_TEST_BASE_URL ?? "http://127.0.0.1:8080";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

class Client {
  cookie = "";

  async request(path, options = {}) {
    const headers = new Headers(options.headers);
    if (this.cookie) headers.set("cookie", this.cookie);
    const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const body = response.status === 204 ? null : await response.json();
    return { response, body };
  }

  json(path, method, value) {
    return this.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
  }
}

function expectStatus(result, expected, message) {
  assert.equal(result.response.status, expected, `${message}: expected ${expected}, got ${result.response.status}`);
}

const sourceText =
  "Photosynthesis converts light energy into chemical energy. Chlorophyll absorbs photons during photosynthesis. Carbon fixation produces glucose molecules through cellular pathways. The Calvin cycle uses carbon dioxide to build carbohydrate molecules.";

const developmentAI = new DevelopmentAIService();
const section = {
  id: "section-step4",
  materialId: "material-step4",
  sectionIndex: 0,
  content: sourceText,
};
const concept = { id: "concept-step4", name: "Photosynthesis" };
const directQuestions = developmentAI.generateQuestionsFromSections([section], [concept], { count: 3 });
assert.ok(directQuestions.length > 0, "development AI should generate grounded questions");
assert.ok(
  directQuestions.every(
    (question) =>
      question.materialId === section.materialId &&
      question.sectionId === section.id &&
      section.content.includes(question.sourceExcerpt),
  ),
  "development AI questions must retain source grounding",
);
assert.equal(developmentAI.generateQuestionsFromSections([section], [concept], { count: 3, excludeQuestionTexts: directQuestions.map((q) => q.questionText) }).length, 0, "duplicate questions should be excluded");
assert.equal(
  developmentAI.validateGroundedQuestions(
    [{ ...directQuestions[0], correctAnswer: "unsupported answer" }],
    [section],
    [concept],
  ).length,
  0,
  "unsupported answers should be rejected",
);
const mcq = directQuestions.find((question) => question.type === "multiple_choice");
if (mcq) {
  assert.equal(
    developmentAI.validateGroundedQuestions([mcq], [section], [concept]).length,
    1,
    "MCQ answers must be one of the options",
  );
  assert.equal(
    developmentAI.validateGroundedQuestions(
      [{ ...mcq, correctAnswer: "not an option" }],
      [section],
      [concept],
    ).length,
    0,
    "MCQs with an answer outside their options must be rejected",
  );
}

const userA = new Client();
let result = await userA.json("/api/auth/signup", "POST", {
  name: "Step 4 User A",
  email: `step4-a-${suffix}@example.test`,
  password: "correct horse battery staple",
});
expectStatus(result, 201, "User A signup");

result = await userA.json("/api/subjects", "POST", {
  name: "Grounded Biology",
  description: "Step 4 material",
  color: "#3d8f76",
});
expectStatus(result, 201, "subject creation");
const subjectId = result.body.id;

result = await userA.json("/api/materials", "POST", {
  title: "Photosynthesis source",
  subjectId,
  fileType: "text/plain",
  pastedText: sourceText,
});
expectStatus(result, 201, "material creation");
const materialId = result.body.id;

for (let attempt = 0; attempt < 40; attempt += 1) {
  result = await userA.request(`/api/materials/${materialId}`);
  if (result.body.processingStatus !== "PROCESSING") break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.equal(result.body.processingStatus, "READY", "material should be ready before generation");

result = await userA.json(`/api/materials/${materialId}/questions/generate`, "POST", { count: 6 });
expectStatus(result, 201, "grounded question generation");
assert.ok(result.body.length > 0, "generation should return questions");
assert.ok(
  result.body.every(
    (question) =>
      question.id &&
      question.sourceSectionId &&
      question.sourceExcerpt &&
      question.sourceExcerpt.length >= 20 &&
      ["multiple_choice", "true_false", "short_answer"].includes(question.type),
  ),
  "response should expose question provenance and supported models",
);
const generatedIds = result.body.map((question) => question.id);
assert.ok(generatedIds.every((id) => /^[0-9a-f-]{36}$/i.test(id)), "responses should use persisted PostgreSQL IDs");

const repeated = await userA.json(`/api/materials/${materialId}/questions/generate`, "POST", { count: 6 });
expectStatus(repeated, 422, "duplicate generation rejection");

result = await userA.json("/api/practice", "POST", {
  subjectId,
  materialId,
  durationMinutes: 10,
  difficulty: "focused",
  questionCount: 3,
});
expectStatus(result, 201, "practice should use persisted generated questions");
assert.ok(result.body.questions.length > 0, "practice should contain generated questions");
assert.ok(result.body.questions.every((question) => generatedIds.includes(question.id)), "practice should reuse stored questions");
const practiceId = result.body.id;

const userB = new Client();
result = await userB.json("/api/auth/signup", "POST", {
  name: "Step 4 User B",
  email: `step4-b-${suffix}@example.test`,
  password: "correct horse battery staple",
});
expectStatus(result, 201, "User B signup");
expectStatus(
  await userB.json(`/api/materials/${materialId}/questions/generate`, "POST", { count: 1 }),
  404,
  "cross-user generation protection",
);
expectStatus(await userB.request(`/api/practice/${practiceId}`), 404, "cross-user practice protection");

console.log("Step 4 grounded question tests passed.", { materialId, practiceId, generated: generatedIds.length });