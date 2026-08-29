import { Router } from "express";
import { config, cookieOptions } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { authenticate, register, removeSession } from "../services/authService.js";

const router = Router();

router.post("/register", async (req, res, next) => {
  try {
    const user = await register(req.body || {});
    req.session.userId = user.id
    res.status(201).json({ user });
  } catch (error) { next(error); }
});

router.post("/login", async (req, res, next) => {
  try {
    const user = await authenticate(req.body || {});
    req.session.userId = user.id
    res.json({ user });
  } catch (error) { next(error); }
});

router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

router.post("/logout", (req, res, next) => {
  removeSession(req.session?.[config.sessionCookie]);
  res.clearCookie(config.sessionCookie, cookieOptions(0, config.express_session));
  res.status(204).end();
});

export default router;

