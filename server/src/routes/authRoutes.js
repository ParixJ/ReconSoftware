import { Router } from "express";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { authenticate, createSession, register, removeSession } from "../services/authService.js";

const router = Router();

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: config.nodeEnv === "production",
    path: "/",
    maxAge,
  };
}

function issueSession(res, user) {
  const session = createSession(user.id);
  res.cookie(config.sessionCookie, session.token, cookieOptions(config.sessionTtlMs));
}

router.post("/register", async (req, res, next) => {
  try {
    const user = await register(req.body || {});
    issueSession(res, user);
    res.status(201).json({ user });
  } catch (error) { next(error); }
});

router.post("/login", async (req, res, next) => {
  try {
    const user = await authenticate(req.body || {});
    issueSession(res, user);
    res.json({ user });
  } catch (error) { next(error); }
});

router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

router.post("/logout", (req, res) => {
  removeSession(req.cookies?.[config.sessionCookie]);
  res.clearCookie(config.sessionCookie, cookieOptions(0));
  res.status(204).end();
});

export default router;

