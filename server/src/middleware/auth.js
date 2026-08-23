import { config } from "../config.js";
import { AppError } from "../errors.js";
import { resolveSession } from "../services/authService.js";

export function requireAuth(req, _res, next) {
  const user = resolveSession(req.cookies?.[config.sessionCookie]);
  if (!user) return next(new AppError(401, "AUTH_REQUIRED", "Your session has expired. Sign in again."));
  req.user = user;
  next();
}

