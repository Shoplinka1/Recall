import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import {
  createSession,
  createUser,
  deleteSession,
  findUserByEmail,
  getUserForSession,
  isAdminEmail,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  verifyPassword,
} from "../lib/auth";

const router: IRouter = Router();

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: SESSION_TTL_MS,
  path: "/",
};

const credentials = (body: unknown) => {
  if (!body || typeof body !== "object") return undefined;
  const value = body as Record<string, unknown>;
  if (
    typeof value.email !== "string" ||
    typeof value.password !== "string"
  ) {
    return undefined;
  }
  return {
    email: value.email.trim().toLowerCase(),
    password: value.password,
  };
};

router.post("/signup", async (req, res, next) => {
  try {
    const value = credentials(req.body);
    const name =
      req.body && typeof req.body === "object" && typeof req.body.name === "string"
        ? req.body.name.trim()
        : "";
    if (!value || !name || value.email.length > 320 || value.password.length < 8) {
      res.status(400).json({
        error: "Name, a valid email, and a password of at least 8 characters are required",
      });
      return;
    }

    const existing = await findUserByEmail(value.email);
    if (existing) {
      res.status(409).json({ error: "An account with that email already exists" });
      return;
    }

    const user = await createUser({ ...value, name });
    const token = await createSession(user.id);
    res.cookie(SESSION_COOKIE, token, cookieOptions);
    res.status(201).json({ authenticated: true, user });
  } catch (error: any) {
    if (error?.code === "23505") {
      res.status(409).json({ error: "An account with that email already exists" });
      return;
    }
    next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const value = credentials(req.body);
    if (!value) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }
    const user = await findUserByEmail(value.email);
    if (!user || !(await verifyPassword(value.password, user.passwordHash))) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    const token = await createSession(user.id);
    res.cookie(SESSION_COOKIE, token, cookieOptions);
    res.json({
      authenticated: true,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await deleteSession(token);
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

const currentSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    const user = token ? await getUserForSession(token) : undefined;
    res.json({
      authenticated: Boolean(user),
      user: user ?? null,
      isAdmin: Boolean(user && isAdminEmail(user.email)),
    });
  } catch (error) {
    next(error);
  }
};

router.get("/me", currentSession);
router.get("/session", currentSession);

export default router;