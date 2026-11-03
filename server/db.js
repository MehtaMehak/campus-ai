/* ============================================================
   PostgreSQL connection layer
   ------------------------------------------------------------
   Wraps a pg.Pool so a terminated backend connection (e.g. Neon
   57P01) can no longer kill the Node process: the pool purges the
   dead client and the next query() simply opens a fresh one.

   All production DB access goes through this module. Only the
   query() / healthCheck() surface is exposed; the Pool itself stays
   internal so unrelated code cannot depend on it.

   Runtime and utilities share strict certificate/hostname verification
   through db-config.js. The URL chooses the DNS endpoint; URL query
   parameters cannot override TLS. IPv4 selection below only affects
   transport address selection, not the hostname used for verification.
   ============================================================ */

require("dotenv").config();
const dns = require("node:dns");
const net = require("node:net");
const { Pool } = require("pg");
const { getDatabaseConfig } = require("./db-config");

// The Neon pooler publishes IPv6 (AAAA) records, but the IPv6 route on this
// network is dead (ENETUNREACH). Under Node 24's default auto-select-family
// socket logic, pg's socket.connect(port, hostname) staggers through the
// unroutable IPv6 addresses and the IPv4 attempts then stall (ETIMEDOUT).
// Pin the process to IPv4-first lookups and disable auto-family so the
// connection takes the working IPv4 path. All connection details still come
// from DATABASE_URL — no host, port, endpoint, or IP is hard-coded here.
dns.setDefaultResultOrder("ipv4first");
net.setDefaultAutoSelectFamily(false);

const pool = new Pool({
  ...getDatabaseConfig(process.env.DATABASE_URL),
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
