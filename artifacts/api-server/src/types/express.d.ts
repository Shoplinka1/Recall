import type { AuthenticatedUser } from "../lib/auth";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedUser;
    }
  }
}

export {};