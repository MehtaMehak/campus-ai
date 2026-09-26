/* ============================================================
   PostgreSQL connection layer
   ------------------------------------------------------------
   Wraps a pg.Pool so a terminated backend connection (e.g. Neon
   57P01) can no longer kill the Node process: the pool purges the
   dead client and the next query() simply opens a fresh one.

   All production DB access goes through this module. Only the
   query() / healthCheck() surface is exposed; the Pool itself stays
   internal so unrelated code cannot depend on it.

   The connection config intentionally mirrors the previous
   singleton Client exactly — discrete fields, NOT the raw
   DATABASE_URL string — so ssl / channel_binding behavior is
   unchanged (the URL's query parameters are not applied by pg when
   a discrete config object is used).

   The Pool location (host + port) is read from DATABASE_URL, so the
   app follows whatever endpoint the connection string points at
   (Neon direct vs pooled) instead of a hard-coded host. The old
   Neon IP and its `options=endpoint=…` routing parameter were
   coupled to a single fixed host and have been removed. IPv4-first
   DNS ordering + disabled auto-family selection (see module body)
   compensate for a dead IPv6 route on dev networks; the SSL and
   channel-binding behavior is otherwise exactly as before.
   ============================================================ */

require("dotenv").config();
const dns = require("node:dns");
const net = require("node:net");
const { Pool } = require("pg");

// The Neon pooler publishes IPv6 (AAAA) records, but the IPv6 route on this
// network is dead (ENETUNREACH). Under Node 24's default auto-select-family
// socket logic, pg's socket.connect(port, hostname) staggers through the
// unroutable IPv6 addresses and the IPv4 attempts then stall (ETIMEDOUT).
// Pin the process to IPv4-first lookups and disable auto-family so the
// connection takes the working IPv4 path. All connection details still come
// from DATABASE_URL — no host, port, endpoint, or IP is hard-coded here.
dns.setDefaultResultOrder("ipv4first");
net.setDefaultAutoSelectFamily(false);

const dbUrl = new URL(process.env.DATABASE_URL);

const pool = new Pool({
  host: dbUrl.hostname,
  port: Number(dbUrl.port || 5432),
  user: decodeURIComponent(dbUrl.username),
  password: decodeURIComponent(dbUrl.password),
  database: dbUrl.pathname.slice(1),
  ssl: {
    rejectUnauthorized: false,
  },
  max: 10, // pg-pool default kept explicit; not over-tuned
});

// pg.Pool does NOT install a default 'error' listener: a connection
// failure on an idle client is emitted on the pool and, with no listener,
// Node would throw. We attach one that logs concisely (never the URL /
// password / token), never throws, and lets the pool replace the dead
// client on the next acquire. Request-level failures are still surfaced
// to the route callers — this only handles background client deaths.
pool.on("error", (error) => {
  const code = error && error.code ? error.code : "(no error code)";
  console.log(
    `⚠ PostgreSQL pool/client error (code ${code}): ${error && error.message ? error.message : String(error)}`
  );
});

// Run a parameterized query on a pooled connection. Same signature and
// result shape (rows, rowCount, command) as the previous client.query,
// so route code is untouched.
async function query(text, params) {
  return pool.query(text, params);
}

// Fail-fast startup probe: verifies the database is reachable before the
// HTTP server starts listening (replaces the old await client.connect()).
async function healthCheck() {
  await pool.query("SELECT 1");
}

module.exports = {
  query,
  healthCheck,
};