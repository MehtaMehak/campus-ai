const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

// Isolated fixtures only: no real account, database, Gemini, or secret needed.
process.env.JWT_SECRET = "session-security-test-only-secret";
process.env.DOTENV_CONFIG_QUIET = "true";
const auth = require("./auth");

for (const environment of ["production", "development"]) {
  test(`${environment}: cookie settings, session restore, logout and origin protection`, async () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = environment;
    delete require.cache[require.resolve("./request-security")];
    const { allowedOrigins, requireTrustedOrigin } = require("./request-security");
    const app = express();
    app.use(cors({ origin: allowedOrigins, credentials: true }));
    app.use("/api", requireTrustedOrigin);
    app.use(cookieParser());
    app.use(auth.attachUser);
    // Test-only endpoints exercise the real cookie/auth middleware without
    // importing index.js (which would start the database-backed server).
    app.post("/api/session", (_req, res) => {
      auth.setSessionCookie(res, auth.signToken({ id: 123, email: "fixture@example.invalid" }));
      res.json({ ok: true });
    });
    app.get("/api/me", auth.requireAuth, (req, res) => res.json({ id: req.user.id }));
    app.post("/api/logout", (_req, res) => {
      auth.clearSessionCookie(res);
      res.json({ ok: true });
    });
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise((resolve) => server.once("listening", resolve));
      const base = `http://127.0.0.1:${server.address().port}`;
      const origin = "https://campus-ai-virid.vercel.app";
      const login = await fetch(`${base}/api/session`, { method: "POST", headers: { Origin: origin } });
      assert.equal(login.status, 200);
      assert.equal(login.headers.get("access-control-allow-origin"), origin);
      assert.equal(login.headers.get("access-control-allow-credentials"), "true");
      const cookie = login.headers.get("set-cookie");
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /Path=\//);
      assert.match(cookie, /Max-Age=604800/);
      assert.match(cookie, environment === "production" ? /SameSite=None/ : /SameSite=Lax/);
      assert.equal(/; Secure/.test(cookie), environment === "production");
      const restored = await fetch(`${base}/api/me`, { headers: { Cookie: cookie.split(";")[0] } });
      assert.equal(restored.status, 200);
      assert.deepEqual(await restored.json(), { id: 123 });
      for (const value of [undefined, "null", "https://untrusted.example", `${origin}.evil.example`]) {
        const headers = value === undefined ? {} : { Origin: value };
        for (const method of ["POST", "PATCH", "DELETE"]) {
          assert.equal((await fetch(`${base}/api/session`, { method, headers })).status, 403);
        }
      }
      assert.equal((await fetch(`${base}/api/me`)).status, 401);
      assert.equal((await fetch(`${base}/api/me`, { headers: { Cookie: "campus_session=invalid" } })).status, 401);
      const local = await fetch(`${base}/api/session`, { method: "POST", headers: { Origin: "http://localhost:5173" } });
      assert.equal(local.status, environment === "production" ? 403 : 200);
      const preflight = await fetch(`${base}/api/session`, {
        method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
      });
      assert.equal(preflight.status, 204);
      const logout = await fetch(`${base}/api/logout`, { method: "POST", headers: { Origin: origin } });
      assert.equal(logout.status, 200);
      const cleared = logout.headers.get("set-cookie");
      assert.match(cleared, /^campus_session=;/);
      assert.match(cleared, /Expires=Thu, 01 Jan 1970/);
      for (const attribute of ["HttpOnly", "Path=/", environment === "production" ? "SameSite=None" : "SameSite=Lax"]) {
        assert.ok(cleared.includes(attribute));
      }
      assert.equal(/; Secure/.test(cleared), environment === "production");
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (previousEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment;
    }
  });
}
