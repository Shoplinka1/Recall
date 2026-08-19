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
    if (setCookie) {
      this.cookie = setCookie.split(";")[0];
    }
    let body = null;
    if (response.status !== 204) {
      body = await response.json();
    }
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

const unauthenticated = new Client();
expectStatus(await unauthenticated.request("/api/subjects"), 401, "unauthenticated subjects request");

const userA = new Client();
const emailA = `auth-a-${suffix}@example.test`;
expectStatus(
  await userA.json("/api/auth/signup", "POST", { name: "User A", email: emailA, password: "correct horse battery staple" }),
  201,
  "User A signup",
);
const duplicateSignup = await userA.json("/api/auth/signup", "POST", {
  name: "Duplicate",
  email: emailA,
  password: "correct horse battery staple",
});
expectStatus(duplicateSignup, 409, "duplicate email protection");
expectStatus(await userA.request("/api/auth/logout", { method: "POST" }), 204, "User A logout");
const loginA = await userA.json("/api/auth/login", "POST", { email: emailA, password: "correct horse battery staple" });
expectStatus(loginA, 200, "User A login");
assert.equal((await userA.request("/api/auth/me")).body.authenticated, true, "User A /me should be authenticated");

const subjectA = await userA.json("/api/subjects", "POST", {
  name: "Private subject A",
  description: "Owned by User A",
  color: "#3d8f76",
});
expectStatus(subjectA, 201, "User A subject creation");
const subjectIdA = subjectA.body.id;

const materialA = await userA.json("/api/materials", "POST", {
  title: "Private material A",
  subjectId: subjectIdA,
  fileType: "notes",
  pastedText: "Private material owned by User A.",
});
expectStatus(materialA, 201, "User A material creation");
const materialIdA = materialA.body.id;

const practiceA = await userA.json("/api/practice", "POST", {
  subjectId: subjectIdA,
  durationMinutes: 10,
  difficulty: "focused",
  questionCount: 1,
});
expectStatus(practiceA, 201, "User A practice creation");
const practiceIdA = practiceA.body.id;
expectStatus(await userA.request("/api/auth/logout", { method: "POST" }), 204, "User A final logout");

const userB = new Client();
const emailB = `auth-b-${suffix}@example.test`;
expectStatus(
  await userB.json("/api/auth/signup", "POST", { name: "User B", email: emailB, password: "correct horse battery staple" }),
  201,
  "User B signup",
);
const meB = await userB.request("/api/auth/me");
assert.notEqual(meB.body.user.id, loginA.body.user.id, "User B must have a different account");

const subjectsB = await userB.request("/api/subjects");
expectStatus(subjectsB, 200, "User B subjects request");
assert.equal(subjectsB.body.some((subject) => subject.id === subjectIdA), false, "User B must not list User A's subject");
expectStatus(await userB.request(`/api/materials/${materialIdA}`), 404, "User B material ownership check");
expectStatus(
  await userB.json("/api/practice", "POST", {
    subjectId: subjectIdA,
    durationMinutes: 10,
    difficulty: "focused",
    questionCount: 1,
  }),
  404,
  "User B practice ownership check",
);
expectStatus(await userB.request(`/api/practice/${practiceIdA}`), 404, "User B practice read ownership check");

expectStatus(await userB.request("/api/auth/logout", { method: "POST" }), 204, "User B logout");
expectStatus(await userB.request("/api/subjects"), 401, "protected request after logout");

console.log("Auth and ownership tests passed.");