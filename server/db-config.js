const { isIP } = require("node:net");
const { checkServerIdentity } = require("node:tls");

// Pure configuration only: no environment loading, sockets, or SQL. Explicit
// fields deliberately exclude URL query options, so sslmode/ssl/options cannot
// weaken TLS or route a utility to a different endpoint.
function getDatabaseConfig(databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    const host = url.hostname;
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    const database = decodeURIComponent(url.pathname.slice(1));
    const port = Number(url.port || 5432);
    if (!["postgres:", "postgresql:"].includes(url.protocol) ||
        !host || isIP(host.replace(/^\[|\]$/g, "")) ||
        !user || !password || !database || url.hash ||
        !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Invalid connection configuration");
    }
    return {
      host, port, user, password, database,
      ssl: { rejectUnauthorized: true, servername: host, checkServerIdentity },
    };
  } catch {
    // URL/decode errors may contain credentials. Never forward their details.
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL with a DNS hostname, credentials, and database");
  }
}

module.exports = { getDatabaseConfig };
