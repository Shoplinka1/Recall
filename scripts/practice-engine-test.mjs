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

async function waitForMaterial(client, id) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await client.request(`/api/materials/${id}`);
    if (result.body.processingStatus !== "PROCESSING") return result.body;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for material ${id}`);
}

const unauthenticated = new Client();
expectStatus(await unauthenticated.request("/api/practice/not-a-session"), 401, "unauthenticated practice access");

const userA = new Client();
expectStatus(
  await userA.json("/api/auth/signup", "POST", {
    name: "Practice Engine A",
    email: `practice-a-${suffix}@example.test`,
    password: "correct horse battery staple",
  }),
  201,
  "practice user signup",
);

const subject = await userA.json("/api/subjects", "POST", {
  name: "Persisted practice subject",
  description: "Questions used by the real practice engine.",
  color: "#3d8f76",
});
expectStatus(subject, 201, "practice subject creation");

const material = await userA.json("/api/materials", "POST", {
  title: "Practice engine source",
  subjectId: subject.body.id,
  fileType: "notes",
  pastedText: [
    "Photosynthesis converts light energy into chemical energy in plant cells.",
    "Chlorophyll absorbs light in the chloroplast and starts the reaction.",
    "Carbon dioxide and water are used to produce glucose and oxygen.",
    "The Calvin cycle uses ATP and NADPH to build sugar molecules.",
  ].join("\n\n"),
});
expectStatus(material, 201, "practice material creation");
const readyMaterial = await waitForMaterial(userA, material.body.id);
assert.equal(readyMaterial.processingStatus, "READY", "practice source material should be ready");
const generated = await userA.json(`/api/materials/${material.body.id}/questions/generate`, "POST", { count: 12 });
expectStatus(generated, 201, "practice question generation");
assert.ok(generated.body.length >= 3, "practice source should produce several grounded questions");

const session = await userA.json("/api/practice", "POST", {
  subjectId: subject.body.id,
  materialId: material.body.id,
  durationMinutes: 10,
  difficulty: "focused",
  questionCount: 20,
});
expectStatus(session, 201, "practice session creation");
assert.ok(session.body.id, "practice session should have a persisted id");
assert.ok(session.body.questions.length >= 3, "practice should use several persisted questions");
assert.ok(session.body.questions.every((question) => question.id.length === 36), "questions should use database ids");

const byType = new Map(session.body.questions.map((question) => [question.type, question]));
for (const type of ["multiple_choice", "true_false", "short_answer"]) {
  assert.ok(byType.has(type), `practice should deliver ${type} questions`);
}

const selectedQuestions = [...byType.values()];
for (const [index, question] of selectedQuestions.entries()) {
  const answer = index === 0 ? "__intentionally_wrong__" : question.correctAnswer;
  const result = await userA.json(`/api/practice/${session.body.id}`, "POST", {
    questionId: question.id,
    answer,
    confidence: "medium",
    responseTimeMs: 1200,
  });
  expectStatus(result, 200, `${question.type} answer submission`);
  assert.equal(result.body.isCorrect, index !== 0, `${question.type} should be scored from persisted data`);
}

const persistedProgress = await userA.request(`/api/practice/${session.body.id}`);
expectStatus(persistedProgress, 200, "persisted practice progress");
assert.equal(
  persistedProgress.body.currentIndex,
  selectedQuestions.length,
  "submitted answers should update persisted progress",
);

// The remaining questions are answered so completion exercises the full session.
for (const question of session.body.questions) {
  if (selectedQuestions.some((selected) => selected.id === question.id)) continue;
  const result = await userA.json(`/api/practice/${session.body.id}`, "POST", {
    questionId: question.id,
    answer: question.correctAnswer,
    confidence: "high",
    responseTimeMs: 900,
  });
  expectStatus(result, 200, "remaining answer submission");
}

const completed = await userA.json(`/api/practice/${session.body.id}/complete`, "POST", {});
expectStatus(completed, 200, "practice completion");
assert.equal(completed.body.questionsAnswered, session.body.questions.length, "completion should include all attempts");
assert.equal(completed.body.incorrect, 1, "completion should persist the incorrect result");
assert.ok(Number.isFinite(completed.body.score), "completion should persist a numeric score");

const afterCompletion = await userA.request(`/api/practice/${session.body.id}`);
expectStatus(afterCompletion, 200, "completed practice reload");
assert.equal(afterCompletion.body.completed, true, "completed state should survive reload");
assert.equal(afterCompletion.body.results.score, completed.body.score, "persisted score should survive reload");
assert.equal(afterCompletion.body.results.incorrect, 1, "persisted result should survive reload");

const userB = new Client();
expectStatus(
  await userB.json("/api/auth/signup", "POST", {
    name: "Practice Engine B",
    email: `practice-b-${suffix}@example.test`,
    password: "correct horse battery staple",
  }),
  201,
  "second practice user signup",
);
expectStatus(await userB.request(`/api/practice/${session.body.id}`), 404, "cross-user practice read protection");
expectStatus(
  await userB.json(`/api/practice/${session.body.id}`, "POST", {
    questionId: session.body.questions[0].id,
    answer: session.body.questions[0].correctAnswer,
    confidence: "high",
  }),
  404,
  "cross-user answer protection",
);

console.log("Step 5 practice engine tests passed.", {
  sessionId: session.body.id,
  questions: session.body.questions.length,
  score: completed.body.score,
});