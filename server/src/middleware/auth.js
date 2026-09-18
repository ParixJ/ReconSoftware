import { ERROR_CODES } from "../api/errorCodes.js";
import { AppError } from "../errors.js";
import { resolveSession } from "../services/authService.js";

export function requireAuth(req, _res, next) {
  const user = resolveSession(req);
  if (!user) return next(new AppError(401, ERROR_CODES.AUTH_REQUIRED, "Your session has expired. Sign in again."));
  req.user = user;
  next();
}
