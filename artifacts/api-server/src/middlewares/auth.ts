import type { NextFunction, Request, Response } from "express";
import { getUserForSession, isAdminEmail, SESSION_COOKIE } from "../lib/auth";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const user = await getUserForSession(token);
    if (!user) {
      res.clearCookie(SESSION_COOKIE);
      res.status(401).json({ error: "Session expired or invalid" });
      return;
    }
    req.auth = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth || !isAdminEmail(req.auth.email)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}