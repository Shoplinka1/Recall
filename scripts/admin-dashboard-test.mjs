import assert from "node:assert/strict";

const baseUrl =
  process.env.ADMIN_TEST_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8080}`;
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

  json(path, value) {
    return this.request(path, {
      method: "POST",
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

const unauthenticated = new Client();
expectStatus(
  await unauthenticated.request("/api/admin/dashboard"),
  401,
  "unauthenticated admin request",
);

const normalUser = new Client();
const normalEmail = `admin-test-user-${suffix}@example.test`;
expectStatus(
  await normalUser.json("/api/auth/signup", {
    name: "Normal User",
    email: normalEmail,
    password: "correct horse battery staple",
  }),
  201,
  "normal user signup",
);
const normalSession = await normalUser.request("/api/auth/session");
assert.equal(normalSession.body.isAdmin, false, "normal user must not be marked admin");
expectStatus(
  await normalUser.request("/api/admin/dashboard"),
  403,
  "normal user admin request",
);

const adminUser = new Client();
const adminEmail = process.env.ADMIN_TEST_EMAIL;
if (!adminEmail) {
  throw new Error("ADMIN_TEST_EMAIL must be set to run the admin allowlist test.");
}
expectStatus(
  await adminUser.json("/api/auth/signup", {
    name: "Admin User",
    email: adminEmail,
    password: "correct horse battery staple",
  }),
  201,
  "admin user signup",
);
const adminSession = await adminUser.request("/api/auth/session");
assert.equal(adminSession.body.isAdmin, true, "allowlisted user must be marked admin");
const dashboard = await adminUser.request("/api/admin/dashboard");
expectStatus(dashboard, 200, "admin dashboard request");
assert.equal(typeof dashboard.body.metrics.totalUsers, "number");
assert.equal(Array.isArray(dashboard.body.recentPayments), true);
assert.equal(Array.isArray(dashboard.body.recentSignups), true);
assert.equal("passwordHash" in dashboard.body, false, "admin response must not expose secrets");

console.log("Admin access and dashboard tests passed.");