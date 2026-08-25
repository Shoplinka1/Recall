import assert from "node:assert/strict";

const baseUrl = process.env.AUTH_TEST_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8080}`;
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
  assert.equal(
    result.response.status,
    expected,
    `${message}: expected ${expected}, got ${result.response.status}`,
  );
}

async function waitForReady(client, materialId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await client.request(`/api/materials/${materialId}`);
    expectStatus(result, 200, "material status check");
    if (result.body.processingStatus !== "PROCESSING") return result.body;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for material ${materialId}`);
}

const userA = new Client();
let result = await userA.json("/api/auth/signup", "POST", {
  name: "Learning State E2E A",
  email: `learning-state-a-${suffix}@example.test`,
  password: "correct horse battery staple",
});
expectStatus(result, 201, "User A signup");

const subject = await userA.json("/api/subjects", "POST", {
  name: "Learning State Biology",
  description: "Weakness and recommendation persistence",
  color: "#347c67",
});
expectStatus(subject, 201, "subject creation");

const material = await userA.json("/api/materials", "POST", {
  title: "Learning state source",
  subjectId: subject.body.id,
  fileType: "notes",
  pastedText:
    "Photosynthesis converts light energy into chemical energy. Chlorophyll absorbs photons during photosynthesis. Carbon fixation produces glucose molecules through cellular pathways. The Calvin cycle uses carbon dioxide to build carbohydrate molecules.",
});
expectStatus(material, 201, "pasted material creation");
const materialId = material.body.id;
const ready = await waitForReady(userA, materialId);
assert.equal(ready.processingStatus, "READY", "pasted material should become READY");

const sections = await userA.request(`/api/materials/${materialId}/sections`);
expectStatus(sections, 200, "material sections");
assert.ok(sections.body.length > 0, "sections should persist");
assert.ok(sections.body.some((section) => /photosynthesis/i.test(section.content)));

const concepts = await userA.request("/api/concepts");
expectStatus(concepts, 200, "concept list");
assert.ok(concepts.body.length > 0, "concepts should persist");

const generated = await userA.json(`/api/materials/${materialId}/questions/generate`, "POST", {
  count: 12,
});
expectStatus(generated, 201, "grounded question generation");
assert.ok(generated.body.length >= 3, "grounded questions should persist");
assert.ok(
  generated.body.every((question) => question.sourceExcerpt && question.sourceSectionId),
  "questions should retain source grounding",
);

const session = await userA.json("/api/practice", "POST", {
  subjectId: subject.body.id,
  materialId,
  durationMinutes: 10,
  difficulty: "focused",
  questionCount: 6,
});
expectStatus(session, 201, "practice session creation");
assert.ok(session.body.questions.length >= 3, "practice should use persisted questions");

for (const question of session.body.questions) {
  const answered = await userA.json(`/api/practice/${session.body.id}`, "POST", {
    questionId: question.id,
    answer: "__deliberately_incorrect__",
    confidence: "high",
    responseTimeMs: 1200,
  });
  expectStatus(answered, 200, "incorrect answer submission");
  assert.equal(answered.body.isCorrect, false, "deliberately incorrect answer should be rejected");
}

const completed = await userA.json(`/api/practice/${session.body.id}/complete`, "POST", {});
expectStatus(completed, 200, "weakness-producing practice completion");
assert.equal(completed.body.incorrect, session.body.questions.length);

const mistakes = await userA.request("/api/mistakes");
expectStatus(mistakes, 200, "mistake list");
assert.ok(mistakes.body.length >= session.body.questions.length, "mistakes should persist");
const weakConceptName = mistakes.body[0].concept;
const weakConcept = concepts.body.find((concept) => concept.name === weakConceptName);
assert.ok(weakConcept, "mistake should identify a persisted concept");

const recommendations = await userA.request("/api/recommendations");
expectStatus(recommendations, 200, "recommendation list");
const recommendation = recommendations.body.find((item) => item.concept === weakConceptName);
assert.ok(recommendation, "recommendation should use the persisted weak concept");
assert.equal(recommendation.action, "weakness");

const targeted = await userA.json("/api/practice/weakness", "POST", {
  conceptIds: [weakConcept.id],
  durationMinutes: 10,
});
expectStatus(targeted, 201, "targeted weakness practice creation");
assert.equal(targeted.body.sessionType, "weakness");
assert.ok(targeted.body.questions.length > 0, "targeted practice should contain questions");
assert.ok(
  targeted.body.questions.every((question) => question.concept === weakConceptName),
  "targeted practice should use the persisted weak concept",
);

for (const question of targeted.body.questions) {
  const answered = await userA.json(`/api/practice/${targeted.body.id}`, "POST", {
    questionId: question.id,
    answer: "__deliberately_incorrect__",
    confidence: "high",
    responseTimeMs: 1000,
  });
  expectStatus(answered, 200, "targeted practice answer");
  assert.equal(answered.body.isCorrect, false);
}
const targetedCompleted = await userA.json(`/api/practice/${targeted.body.id}/complete`, "POST", {});
expectStatus(targetedCompleted, 200, "targeted practice completion");

const progress = await userA.request("/api/progress");
expectStatus(progress, 200, "progress");
assert.ok(progress.body.questionsAnswered >= session.body.questions.length);
assert.ok(Number.isFinite(progress.body.overallMastery));
assert.ok(progress.body.concepts.some((concept) => concept.name === weakConceptName));

const dashboard = await userA.request("/api/dashboard");
expectStatus(dashboard, 200, "dashboard recommendation");
assert.equal(dashboard.body.recommendation.concept, weakConceptName);

const reloadedMistakes = await userA.request("/api/mistakes");
const reloadedRecommendations = await userA.request("/api/recommendations");
const reloadedProgress = await userA.request("/api/progress");
const reloadedTargeted = await userA.request(`/api/practice/${targeted.body.id}`);
for (const [reloaded, message] of [
  [reloadedMistakes, "reloaded mistakes"],
  [reloadedRecommendations, "reloaded recommendations"],
  [reloadedProgress, "reloaded progress"],
  [reloadedTargeted, "reloaded study state"],
]) {
  expectStatus(reloaded, 200, message);
}
assert.equal(reloadedMistakes.body.length, mistakes.body.length + targeted.body.questions.length);
assert.ok(reloadedRecommendations.body.some((item) => item.concept === weakConceptName));
assert.equal(reloadedProgress.body.questionsAnswered, progress.body.questionsAnswered);
assert.equal(reloadedTargeted.body.completed, true);

const userB = new Client();
result = await userB.json("/api/auth/signup", "POST", {
  name: "Learning State E2E B",
  email: `learning-state-b-${suffix}@example.test`,
  password: "correct horse battery staple",
});
expectStatus(result, 201, "User B signup");

const otherMistakes = await userB.request("/api/mistakes");
const otherRecommendations = await userB.request("/api/recommendations");
const otherProgress = await userB.request("/api/progress");
const otherPractice = await userB.request(`/api/practice/${targeted.body.id}`);
const otherMaterial = await userB.request(`/api/materials/${materialId}`);
expectStatus(otherMistakes, 200, "User B mistakes");
expectStatus(otherRecommendations, 200, "User B recommendations");
expectStatus(otherProgress, 200, "User B progress");
expectStatus(otherPractice, 404, "cross-user practice protection");
expectStatus(otherMaterial, 404, "cross-user material protection");
assert.deepEqual(otherMistakes.body, []);
assert.deepEqual(otherRecommendations.body, []);
assert.equal(otherProgress.body.questionsAnswered, 0);

console.log("Learning state E2E tests passed.", {
  materialId,
  weakness: weakConceptName,
  mistakes: reloadedMistakes.body.length,
  recommendations: reloadedRecommendations.body.length,
  progressQuestions: reloadedProgress.body.questionsAnswered,
  targetedPracticeId: targeted.body.id,
});