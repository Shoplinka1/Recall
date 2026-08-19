import { createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@workspace/db";
import { sessionsTable, usersTable } from "@workspace/db/schema";

export const SESSION_COOKIE = "recall_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error("SESSION_SECRET must be set.");
}

export type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
};

const publicUser = (user: typeof usersTable.$inferSelect): AuthenticatedUser => ({
  id: user.id,
  name: user.name,
  email: user.email,
});

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const hashSessionToken = (token: string) =>
  createHmac("sha256", sessionSecret).update(token).digest("hex");

export async function createUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthenticatedUser> {
  const [user] = await db
    .insert(usersTable)
    .values({
      name: input.name.trim(),
      email: normalizeEmail(input.email),
      passwordHash: await bcrypt.hash(input.password, 12),
    })
    .returning();
  return publicUser(user);
}

export async function findUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normalizeEmail(email)))
    .limit(1);
  return user;
}

export async function verifyPassword(password: string, passwordHash: string | null) {
  return Boolean(passwordHash) && bcrypt.compare(password, passwordHash);
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  await db.insert(sessionsTable).values({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

export async function getUserForSession(token: string): Promise<AuthenticatedUser | undefined> {
  const tokenHash = hashSessionToken(token);
  const [row] = await db
    .select({ user: usersTable })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(
      and(
        eq(sessionsTable.tokenHash, tokenHash),
        gt(sessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row ? publicUser(row.user) : undefined;
}

export async function deleteSession(token: string) {
  await db.delete(sessionsTable).where(eq(sessionsTable.tokenHash, hashSessionToken(token)));
}