/* ============================================================
   Authentication layer
   ------------------------------------------------------------
   Owns password hashing, JWT signing/verification and the
   httpOnly session cookie. The routes in index.js only call the
   small helpers here.

   Secrets never leave the server:
   - JWT_SECRET lives in server/.env and is read via dotenv
   - only the user's id + email go inside the token
   - the session cookie is httpOnly, so browser JS can't read it
   ============================================================ */

require("dotenv").config();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET is missing in the server .env file. Add it to enable authentication."
  );
}

// The httpOnly session cookie name
const COOKIE_NAME = "campus_session";
// 7 days, matching the JWT expiry
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// bcrypt cost factor (10 rounds ≈ 100ms — fine for a student app)
const BCRYPT_ROUNDS = 10;

/* -------- passwords -------- */

async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

// Timing-safe comparison via bcrypt — user enumeration is handled by the
// route returning the same generic message for a bad email and a bad password.
function verifyPassword(plain, hash) {
  // Guard against non-bcrypt values (e.g. the legacy placeholder '!'), so a
  // login attempt against such a row resolves to false instead of throwing.
  if (!hash || typeof hash !== "string" || !hash.startsWith("$2")) {
    return Promise.resolve(false);
  }
  return bcrypt.compare(plain, hash);
}

/* -------- tokens -------- */

// The JWT carries only the user id + email (no secrets).
function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: "7d",
  });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

/* -------- the session cookie -------- */

// httpOnly: JS can't read it (safe against XSS token theft).
// SameSite=Lax still lets the cookie travel from http://localhost:5173 to
// http://localhost:5000 — same site (same host), different port — so the
// SPA can authenticate without storing the token anywhere.
// secure is environment-driven: false over plain http in local dev
// (NODE_ENV unset/non-production), true only when NODE_ENV=production
// (the deployed app runs behind HTTPS).
function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

/* -------- Express middleware -------- */

// attachUser: fill req.user from a valid cookie when present. Never errors —
// an absent/expired/invalid cookie simply means req.user is null.
function attachUser(req, _res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  const payload = token ? verifyToken(token) : null;
  req.user =
    payload && payload.sub ? { id: payload.sub, email: payload.email } : null;
  next();
}

// requireAuth: respond 401 when there is no logged-in user.
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Please log in to continue" });
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  requireAuth,
};