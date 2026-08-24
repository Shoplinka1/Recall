import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { CreateCheckoutBody } from "@workspace/api-zod";
import { db } from "@workspace/db";
import {
  billingEventsTable,
  paymentTransactionsTable,
  subscriptionsTable,
  usersTable,
} from "@workspace/db/schema";
import { requireAuth } from "../middlewares/auth";
import {
  createPaymentReference,
  createPaystackClient,
  eventKeyFor,
  isPaystackSignatureValid,
  isSuccessfulTransaction,
} from "../lib/paystack";

const router: IRouter = Router();

const configuredPlan = (interval: string) =>
  interval === "annual"
    ? process.env.PAYSTACK_PRO_ANNUAL_PLAN_CODE
    : process.env.PAYSTACK_PRO_MONTHLY_PLAN_CODE;

const appUrl = () => (process.env.APP_URL ?? "").replace(/\/+$/, "");

async function persistSuccessfulPayment(
  transaction: typeof paymentTransactionsTable.$inferSelect,
  verified: Awaited<ReturnType<ReturnType<typeof createPaystackClient>["verifyTransaction"]>>,
) {
  if (!isSuccessfulTransaction(verified) || verified.reference !== transaction.reference) {
    throw new Error("Paystack verification did not match a successful transaction");
  }
  if (verified.plan?.plan_code && verified.plan.plan_code !== transaction.planCode) {
    throw new Error("Paystack verification returned an unexpected plan");
  }
  const [user] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, transaction.userId))
    .limit(1);
  if (
    !user ||
    !verified.customer?.email ||
    user.email.trim().toLowerCase() !== verified.customer.email.trim().toLowerCase()
  ) {
    throw new Error("Paystack payment customer does not match the Recall account");
  }
  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + (transaction.interval === "annual" ? 12 : 1));
  await db.transaction(async (tx) => {
    await tx
      .update(paymentTransactionsTable)
      .set({
        status: "paid",
        providerTransactionId: verified.id ? String(verified.id) : null,
        providerCustomerCode: verified.customer?.customer_code ?? null,
        amount: verified.amount ?? transaction.amount,
        currency: verified.currency ?? transaction.currency,
        paidAt: verified.paid_at ? new Date(verified.paid_at) : new Date(),
      })
      .where(eq(paymentTransactionsTable.id, transaction.id));
    await tx
      .insert(subscriptionsTable)
      .values({
        userId: transaction.userId,
        provider: "paystack",
        providerCustomerCode: verified.customer?.customer_code ?? null,
        providerSubscriptionCode: null,
        providerPlanCode: transaction.planCode,
        plan: "plus",
        status: "active",
        amount: verified.amount ?? transaction.amount,
        currency: verified.currency ?? transaction.currency,
        currentPeriodStart: new Date(),
        currentPeriodEnd: periodEnd,
      })
      .onConflictDoUpdate({
        target: subscriptionsTable.userId,
        set: {
          provider: "paystack",
          providerCustomerCode: verified.customer?.customer_code ?? null,
          providerPlanCode: transaction.planCode,
          plan: "plus",
          status: "active",
          amount: verified.amount ?? transaction.amount,
          currency: verified.currency ?? transaction.currency,
          currentPeriodEnd: periodEnd,
          updatedAt: new Date(),
        },
      });
  });
}

async function applyPaystackEvent(event: string, payload: Record<string, unknown>) {
  const data = (payload.data ?? payload) as Record<string, unknown>;
  const reference = typeof data.reference === "string" ? data.reference : undefined;
  const eventKey = eventKeyFor(event, {
    reference,
    id: typeof data.id === "string" || typeof data.id === "number" ? data.id : undefined,
  });
  const inserted = await db
    .insert(billingEventsTable)
    .values({ eventKey, event, reference: reference ?? null, payload })
    .onConflictDoNothing({ target: billingEventsTable.eventKey })
    .returning({ id: billingEventsTable.id });
  if (!inserted.length || !reference) return { duplicate: !inserted.length };

  const [transaction] = await db
    .select()
    .from(paymentTransactionsTable)
    .where(eq(paymentTransactionsTable.reference, reference))
    .limit(1);
  if (!transaction) return { ignored: true };

  if (event === "charge.success") {
    const verified = await createPaystackClient().verifyTransaction(reference);
    await persistSuccessfulPayment(transaction, verified);
  } else if (["charge.failed", "subscription.not_renew", "subscription.disable"].includes(event)) {
    await db
      .update(paymentTransactionsTable)
      .set({ status: event === "charge.failed" ? "failed" : "expired" })
      .where(and(eq(paymentTransactionsTable.id, transaction.id), eq(paymentTransactionsTable.status, "pending")));
    if (event !== "charge.failed") {
      await db
        .update(subscriptionsTable)
        .set({ status: "cancelled", plan: "free", updatedAt: new Date() })
        .where(eq(subscriptionsTable.userId, transaction.userId));
    }
  }
  return { processed: true };
}

router.post("/checkout", requireAuth, async (req, res, next) => {
  try {
    const input = CreateCheckoutBody.parse(req.body);
    const planCode = configuredPlan(input.interval);
    if (!process.env.PAYSTACK_SECRET_KEY || !planCode || !appUrl()) {
      res.status(503).json({
        url: null,
        configured: false,
        message: "Paystack requires a server secret, plan code, and public APP_URL.",
      });
      return;
    }
    const reference = createPaymentReference(req.auth!.id);
    const [transaction] = await db
      .insert(paymentTransactionsTable)
      .values({
        userId: req.auth!.id,
        reference,
        interval: input.interval,
        planCode,
        status: "pending",
        metadata: { userId: req.auth!.id, interval: input.interval },
      })
      .returning();
    try {
      const checkout = await createPaystackClient().initializeTransaction({
        email: req.auth!.email,
        reference,
        plan: planCode,
        callbackUrl: `${appUrl()}/api/billing/callback`,
        metadata: { userId: req.auth!.id, reference, interval: input.interval },
      });
      await db
        .update(paymentTransactionsTable)
        .set({ accessCode: checkout.access_code })
        .where(eq(paymentTransactionsTable.id, transaction.id));
      res.json({ url: checkout.authorization_url, configured: true, message: "Paystack checkout initialized." });
    } catch (error) {
      await db
        .update(paymentTransactionsTable)
        .set({ status: "failed" })
        .where(eq(paymentTransactionsTable.id, transaction.id));
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

router.get("/callback", requireAuth, async (req, res, next) => {
  try {
    const reference = typeof req.query.reference === "string" ? req.query.reference : "";
    const [transaction] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(and(eq(paymentTransactionsTable.reference, reference), eq(paymentTransactionsTable.userId, req.auth!.id)))
      .limit(1);
    if (!transaction) {
      res.status(404).json({ error: "Payment reference not found for this account" });
      return;
    }
    const verified = await createPaystackClient().verifyTransaction(reference);
    if (!isSuccessfulTransaction(verified)) {
      await db.update(paymentTransactionsTable).set({ status: "failed" }).where(eq(paymentTransactionsTable.id, transaction.id));
      res.status(402).json({ error: "Payment was not successful" });
      return;
    }
    await persistSuccessfulPayment(transaction, verified);
    res.json({ verified: true, status: "active" });
  } catch (error) {
    next(error);
  }
});

router.post("/webhook", async (req, res, next) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
    if (!secret || !rawBody || !isPaystackSignatureValid(rawBody, req.header("x-paystack-signature"), secret)) {
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }
    const payload = req.body as Record<string, unknown>;
    const event = typeof payload.event === "string" ? payload.event : "";
    if (!event) {
      res.status(400).json({ error: "Missing webhook event" });
      return;
    }
    await applyPaystackEvent(event, payload);
    res.json({ received: true });
  } catch (error) {
    next(error);
  }
});

export { applyPaystackEvent };
export default router;