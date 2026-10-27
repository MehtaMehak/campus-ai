// One explicit allowlist for CORS and CSRF protection. Do not trust Host or
// forwarded headers to decide whether a browser origin is allowed.
const allowedOrigins = ["https://campus-ai-virid.vercel.app"];
if (process.env.NODE_ENV !== "production") {
  allowedOrigins.push("http://localhost:5173");
}

function requireTrustedOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  // Fail closed for missing and opaque ("null") origins too. Non-browser
  // clients making mutations must explicitly supply an allowed Origin.
  if (!allowedOrigins.includes(req.get("Origin"))) {
    return res.status(403).json({ error: "Request origin is not allowed" });
  }
  next();
}

module.exports = { allowedOrigins, requireTrustedOrigin };
