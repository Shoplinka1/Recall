import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type PaystackTransaction = {
  id?: number | string;
  status?: string;
  reference?: string;
  amount?: number;
  currency?: string;
  paid_at?: string | null;
  customer?: { customer_code?: string; email?: string };
  plan?: { plan_code?: string };
};

type PaystackResponse<T> = {
  status: boolean;
  message: string;
  data: T;
};

export type PaystackClient = {
  initializeTransaction(input: {
    email: string;
    reference: string;
    plan: string;
    callbackUrl: string;
    metadata: Record<string, string>;
  }): Promise<{ authorization_url: string; access_code: string; reference: string }>;
  verifyTransaction(reference: string): Promise<PaystackTransaction>;
};

export const PAYSTACK_API_URL = "https://api.paystack.co";

export function createPaystackClient(secretKey = process.env.PAYSTACK_SECRET_KEY): PaystackClient {
  if (!secretKey) throw new Error("PAYSTACK_SECRET_KEY is not configured");
  const request = async <T>(path: string, init: RequestInit): Promise<T> => {
    const response = await fetch(`${PAYSTACK_API_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await response.json()) as PaystackResponse<T>;
    if (!response.ok || !body.status) {
      throw new Error(`Paystack request failed: ${body.message || response.statusText}`);
    }
    return body.data;
  };
  return {
    initializeTransaction: (input) =>
      request("/transaction/initialize", {
        method: "POST",
        body: JSON.stringify({
          email: input.email,
          reference: input.reference,
          plan: input.plan,
          callback_url: input.callbackUrl,
          metadata: input.metadata,
        }),
      }),
    verifyTransaction: (reference) =>
      request(`/transaction/verify/${encodeURIComponent(reference)}`, { method: "GET" }),
  };
}

export const createPaymentReference = (userId: string) =>
  `recall_${userId.slice(0, 8)}_${Date.now()}_${randomUUID().replaceAll("-", "")}`;

export const isPaystackSignatureValid = (
  rawBody: Buffer | string,
  signature: string | undefined,
  secretKey: string,
) => {
  if (!signature) return false;
  const expected = createHmac("sha512", secretKey).update(rawBody).digest("hex");
  const received = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return received.length === expectedBuffer.length && timingSafeEqual(received, expectedBuffer);
};

export const isSuccessfulTransaction = (transaction: PaystackTransaction) =>
  transaction.status === "success" && Boolean(transaction.reference);

export const eventKeyFor = (event: string, payload: PaystackTransaction) =>
  `${event}:${payload.reference ?? payload.id ?? "unknown"}`;