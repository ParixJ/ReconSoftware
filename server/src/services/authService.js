import crypto from "node:crypto";
import { promisify } from "node:util";
import { getDb } from "../db/database.js";
import { config } from "../config.js";
import { AppError } from "../errors.js";

const scrypt = promisify(crypto.scrypt);

function publicUser(user) {
  return user ? { id: user.id, email: user.email, name: user.name, createdAt: user.created_at } : null;
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const digest = await scrypt(password, salt, 64);
  return `${salt}:${Buffer.from(digest).toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const digest = Buffer.from(await scrypt(password, salt, 64));
  const expected = Buffer.from(hash, "hex");
  return digest.length === expected.length && crypto.timingSafeEqual(digest, expected);
}

function sessionHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function validateCredentials({ name, email, password }, registering = false) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    throw new AppError(400, "INVALID_EMAIL", "Enter a valid email address.");
  }
  if (String(password || "").length < 8) {
    throw new AppError(400, "WEAK_PASSWORD", "Password must contain at least 8 characters.");
  }
  const normalizedName = String(name || "").trim();
  if (registering && normalizedName.length < 2) {
    throw new AppError(400, "INVALID_NAME", "Enter the auditor's name.");
  }
  return { name: normalizedName, email: normalizedEmail, password: String(password) };
}

export async function register(input) {
  const values = validateCredentials(input, true);
  const db = getDb();
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(values.email)) {
    throw new AppError(409, "EMAIL_EXISTS", "An account already exists for this email. Sign in instead.");
  }
  const user = {
    id: crypto.randomUUID(),
    email: values.email,
    name: values.name,
    password_hash: await hashPassword(values.password),
    created_at: new Date().toISOString(),
  };
  db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (@id, @email, @name, @password_hash, @created_at)").run(user);
  return publicUser(user);
}

export async function authenticate(input) {
  const values = validateCredentials(input, false);
  const user = getDb().prepare("SELECT * FROM users WHERE email = ?").get(values.email);
  if (!user || !(await verifyPassword(values.password, user.password_hash))) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  }
  return publicUser(user);
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  const expiresAt = Date.now() + config.sessionTtlMs;
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  db.prepare("INSERT INTO sessions (id_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(sessionHash(token), userId, expiresAt, now);
  return { token, expiresAt };
}

export function resolveSession(token) {
  if (!token) return null;
  const row = getDb().prepare(`
    SELECT u.id, u.email, u.name, u.created_at, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id_hash = ? AND s.expires_at > ?
  `).get(sessionHash(token), Date.now());
  return publicUser(row);
}

export function removeSession(token) {
  if (token) getDb().prepare("DELETE FROM sessions WHERE id_hash = ?").run(sessionHash(token));
}
