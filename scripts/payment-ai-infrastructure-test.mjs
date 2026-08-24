import assert from "node:assert/strict";

const originalFetch = globalThis.fetch;
const originalSecret = process.env.PAYSTACK_SECRET_KEY;
const originalAiMode = process.env.AI_MODE;
const originalGeminiKey = process.env.GEMINI_API_KEY;

try {
  const { createPaymentReference, createPaystackClient, isPaystackSignatureValid } =
    await import("../artifacts/api-server/src/lib/paystack.ts");

  const reference = createPaymentReference("12345678-aaaa-bbbb-cccc-dddddddddddd");
  assert.match(reference, /^recall_12345678_\d+_[a-f0-9]{32}$/);
  assert.notEqual(reference, createPaymentReference("12345678-aaaa-bbbb-cccc-dddddddddddd"));

  const secret = "unit-test-secret";
  process.env.PAYSTACK_SECRET_KEY = secret;
  const payload = JSON.stringify({ event: "charge.success", data: { reference } });
  const { createHmac } = await import("node:crypto");
  const signature = createHmac("sha512", secret).update(payload).digest("hex");
  assert.equal(isPaystackSignatureValid(payload, signature, secret), true);
  assert.equal(isPaystackSignatureValid(payload, "bad-signature", secret), false);
  assert.equal(isPaystackSignatureValid(payload, undefined, secret), false);

  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    const isInitialize = url.endsWith("/transaction/initialize");
    return new Response(
      JSON.stringify({
        status: true,
        message: "ok",
        data: isInitialize
          ? { authorization_url: "https://checkout.test/abc", access_code: "access", reference }
          : { status: "success", reference, id: 42, amount: 800, currency: "NGN" },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const client = createPaystackClient(secret);
  const checkout = await client.initializeTransaction({
    email: "learner@example.com",
    reference,
    plan: "PLN_test",
    callbackUrl: "https://recall.test/api/billing/callback",
    metadata: { userId: "user-1", reference },
  });
  assert.equal(checkout.authorization_url, "https://checkout.test/abc");
  const verified = await client.verifyTransaction(reference);
  assert.equal(verified.status, "success");
  assert.equal(requests.length, 2);
  assert.equal(new Headers(requests[0].init.headers).get("authorization"), `Bearer ${secret}`);
  assert.match(requests[1].url, /transaction\/verify\/recall_/);

  process.env.AI_MODE = "development";
  delete process.env.GEMINI_API_KEY;
  const { DevelopmentAIService, getAIService } =
    await import("../artifacts/api-server/src/lib/ai.ts");
  assert.equal(getAIService() instanceof DevelopmentAIService, true);
  assert.ok(new DevelopmentAIService().generateQuestions("This is a sufficiently long grounded sentence about photosynthesis.").length > 0);

  process.env.AI_MODE = "real";
  assert.throws(() => getAIService(), /GEMINI_API_KEY/);
  process.env.GEMINI_API_KEY = "not-used-by-this-test";
  assert.equal(getAIService().constructor.name, "RealGeminiAIService");

  console.log("payment and AI infrastructure checks passed");
} finally {
  globalThis.fetch = originalFetch;
  if (originalSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
  else process.env.PAYSTACK_SECRET_KEY = originalSecret;
  if (originalAiMode === undefined) delete process.env.AI_MODE;
  else process.env.AI_MODE = originalAiMode;
  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiKey;
}