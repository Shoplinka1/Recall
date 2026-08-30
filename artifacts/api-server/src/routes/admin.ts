import { Router, type IRouter } from "express";
import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@workspace/db";
import {
  paymentTransactionsTable,
  subscriptionsTable,
  usersTable,
} from "@workspace/db/schema";
import { requireAdmin, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.use(requireAuth, requireAdmin);

router.get("/dashboard", async (_req, res, next): Promise<void> => {
  try {
    const activeSubscriptionFilter = and(
      eq(subscriptionsTable.status, "active"),
      eq(subscriptionsTable.plan, "plus"),
      or(
        isNull(subscriptionsTable.currentPeriodEnd),
        gt(subscriptionsTable.currentPeriodEnd, new Date()),
      ),
    );

    const [
      [{ totalUsers }],
      [{ proUsers }],
      [{ successfulPayments, revenueNgn }],
      activeSubscriptions,
      recentPayments,
      recentSignups,
    ] = await Promise.all([
      db.select({ totalUsers: count() }).from(usersTable),
      db
        .select({ proUsers: count() })
        .from(subscriptionsTable)
        .where(activeSubscriptionFilter),
      db
        .select({
          successfulPayments: count(),
          revenueNgn: sql<number>`coalesce(sum(${paymentTransactionsTable.amount}), 0)`,
        })
        .from(paymentTransactionsTable)
        .where(
          and(
            eq(paymentTransactionsTable.status, "paid"),
            eq(paymentTransactionsTable.currency, "NGN"),
          ),
        ),
      db
        .select({ userId: subscriptionsTable.userId })
        .from(subscriptionsTable)
        .where(activeSubscriptionFilter),
      db
        .select({
          id: paymentTransactionsTable.id,
          name: usersTable.name,
          email: usersTable.email,
          reference: paymentTransactionsTable.reference,
          interval: paymentTransactionsTable.interval,
          amount: paymentTransactionsTable.amount,
          currency: paymentTransactionsTable.currency,
          status: paymentTransactionsTable.status,
          paidAt: paymentTransactionsTable.paidAt,
          createdAt: paymentTransactionsTable.createdAt,
        })
        .from(paymentTransactionsTable)
        .innerJoin(usersTable, eq(paymentTransactionsTable.userId, usersTable.id))
        .orderBy(
          desc(
            sql`coalesce(${paymentTransactionsTable.paidAt}, ${paymentTransactionsTable.createdAt})`,
          ),
        )
        .limit(8),
      db
        .select({
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
          createdAt: usersTable.createdAt,
          plan: subscriptionsTable.plan,
          subscriptionStatus: subscriptionsTable.status,
        })
        .from(usersTable)
        .leftJoin(
          subscriptionsTable,
          eq(subscriptionsTable.userId, usersTable.id),
        )
        .orderBy(desc(usersTable.createdAt))
        .limit(8),
    ]);

    const activeUserIds = activeSubscriptions.map(({ userId }) => userId);
    const latestIntervalByUser = new Map<string, string>();
    if (activeUserIds.length) {
      const paidTransactions = await db
        .select({
          userId: paymentTransactionsTable.userId,
          interval: paymentTransactionsTable.interval,
        })
        .from(paymentTransactionsTable)
        .where(
          and(
            eq(paymentTransactionsTable.status, "paid"),
            eq(paymentTransactionsTable.currency, "NGN"),
            inArray(paymentTransactionsTable.userId, activeUserIds),
          ),
        )
        .orderBy(
          desc(
            sql`coalesce(${paymentTransactionsTable.paidAt}, ${paymentTransactionsTable.createdAt})`,
          ),
        );

      for (const transaction of paidTransactions) {
        if (!latestIntervalByUser.has(transaction.userId)) {
          latestIntervalByUser.set(transaction.userId, transaction.interval);
        }
      }
    }

    const totalUsersCount = Number(totalUsers);
    const proUsersCount = Number(proUsers);

    res.json({
      metrics: {
        totalUsers: totalUsersCount,
        freeUsers: Math.max(0, totalUsersCount - proUsersCount),
        proUsers: proUsersCount,
        successfulPayments: Number(successfulPayments),
        revenueNgn: Number(revenueNgn ?? 0),
        activeMonthlySubscribers: [...latestIntervalByUser.values()].filter(
          (interval) => interval === "monthly",
        ).length,
        activeAnnualSubscribers: [...latestIntervalByUser.values()].filter(
          (interval) => interval === "annual",
        ).length,
      },
      recentPayments: recentPayments.map((payment) => ({
        id: payment.id,
        name: payment.name,
        email: payment.email,
        reference: payment.reference,
        interval: payment.interval,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        paidAt: payment.paidAt?.toISOString() ?? null,
        createdAt: payment.createdAt.toISOString(),
      })),
      recentSignups: recentSignups.map((signup) => ({
        id: signup.id,
        name: signup.name,
        email: signup.email,
        plan:
          signup.plan === "plus" && signup.subscriptionStatus === "active"
            ? "plus"
            : "free",
        createdAt: signup.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});

export default router;