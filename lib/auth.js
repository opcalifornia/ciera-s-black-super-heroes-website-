// Admin authentication: cookie sessions + bcrypt-hashed password + CSRF.
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const store = require("../db");

const SESSION_COOKIE = "admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// In-memory session store. This app runs as a single Node process (SQLite
// on a local/attached disk already assumes that), so this is fine; a
// multi-instance deployment would need a shared store instead.
const sessions = new Map();

function ensurePasswordHash() {
  const envPassword = process.env.ADMIN_PASSWORD || "change-me";
  const stored = store.getInternalSetting("_adminPasswordHash");
  // Re-hash only when the stored hash doesn't match the current env
  // password (first run, or the password was rotated via a redeploy).
  if (stored && bcrypt.compareSync(envPassword, stored)) return;
  store.setInternalSetting("_adminPasswordHash", bcrypt.hashSync(envPassword, 12));
}
ensurePasswordHash();

function verifyPassword(password) {
  const hash = store.getInternalSetting("_adminPasswordHash");
  return !!hash && bcrypt.compareSync(String(password || ""), hash);
}

function pruneExpired() {
  const now = Date.now();
  for (const [token, s] of sessions) if (now > s.expires) sessions.delete(token);
}

function createSession() {
  pruneExpired();
  const token = crypto.randomBytes(32).toString("hex");
  const csrfToken = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { csrfToken, expires: Date.now() + SESSION_TTL_MS });
  return { token, csrfToken };
}

function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expires) { sessions.delete(token); return null; }
  return s;
}

function destroySession(token) {
  sessions.delete(token);
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_MS,
  };
}

// ---------- middleware ----------
function requireSession(req, res, next) {
  const session = getSession(req.cookies && req.cookies[SESSION_COOKIE]);
  if (!session) return res.status(401).json({ error: "Please sign in again." });
  req.adminSession = session;
  next();
}

function requireCsrf(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD") return next();
  const token = req.headers["x-csrf-token"];
  if (!req.adminSession || token !== req.adminSession.csrfToken) {
    return res.status(403).json({ error: "Your session expired. Refresh the page and try again." });
  }
  next();
}

module.exports = {
  SESSION_COOKIE, cookieOptions,
  verifyPassword, createSession, getSession, destroySession,
  requireSession, requireCsrf,
};
