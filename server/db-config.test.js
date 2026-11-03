const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const tls = require("node:tls");
const { getDatabaseConfig } = require("./db-config");
const { Client } = require("pg");

const fixtureUrl = "postgresql://fixture%40role:fake%3Apassword@ep-fixture-pooler.example.invalid:6543/study%20desk";

test("parses encoded credentials/database and preserves pooled/direct DNS endpoints", () => {
  const config = getDatabaseConfig(fixtureUrl);
  assert.equal(config.host, "ep-fixture-pooler.example.invalid");
  assert.equal(config.port, 6543);
  assert.equal(config.user, "fixture@role");
  assert.equal(config.password, "fake:password");
  assert.equal(config.database, "study desk");
  const direct = getDatabaseConfig("postgres://fixture:fake@ep-fixture.example.invalid/neondb");
  assert.equal(direct.port, 5432);
  assert.equal(direct.host, "ep-fixture.example.invalid");
});

test("URL SSL/routing options cannot weaken effective pg TLS settings", () => {
  for (const query of ["sslmode=disable", "sslmode=no-verify", "ssl=false", "ssl=0", "sslmode=require&uselibpqcompat=true", "sslrootcert=/does-not-exist&sslcert=/does-not-exist", "options=endpoint%3Dother&host=other.example.invalid&channel_binding=require"]) {
    const config = getDatabaseConfig(`${fixtureUrl}?${query}`);
    // Client construction parses configuration but does not connect.
    const client = new Client(config);
    assert.equal(client.connectionParameters.host, config.host);
    assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
    assert.equal(client.connectionParameters.ssl.servername, config.host);
    assert.equal(client.connectionParameters.ssl.checkServerIdentity, tls.checkServerIdentity);
    assert.equal(config.connectionString, undefined);
    assert.equal(config.options, undefined);
  }
});

test("hostname verification accepts a matching certificate and rejects another host", () => {
  const config = getDatabaseConfig(fixtureUrl);
  const cert = { subjectaltname: `DNS:${config.host}` };
  assert.equal(config.ssl.checkServerIdentity(config.ssl.servername, cert), undefined);
  assert.equal(config.ssl.checkServerIdentity(config.ssl.servername, { subjectaltname: "DNS:other.example.invalid" }).code, "ERR_TLS_CERT_ALTNAME_INVALID");
  assert.equal(config.ssl.rejectUnauthorized, true); // Node also validates the CA chain.
});

test("invalid URLs and IP endpoints fail with sanitized errors", () => {
  for (const value of [undefined, "", "secret-invalid-url", "https://fixture:fake@example.invalid/db", "postgres://fixture:fake@127.0.0.1/db", "postgres://fixture:fake@[::1]/db", "postgres://fixture:fake@example.invalid", "postgres://fixture@example.invalid/db", "postgres://fixture:fake@example.invalid:0/db", "postgres://fixture:fake@example.invalid/%ZZ"]) {
    assert.throws(() => getDatabaseConfig(value), (error) => {
      assert.equal(error.message, "DATABASE_URL must be a valid PostgreSQL URL with a DNS hostname, credentials, and database");
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test("runtime and all utilities use shared TLS config with mocked connections only", async () => {
  for (const file of ["db.js", "setup-db.js", "add-courses.js", "check-db.js", "test-db.js"]) {
    let captured;
    let ended = false;
    let poolErrorHandler;
    const queries = [];
    const dnsCalls = [];
    const familyCalls = [];
    class MockConnection {
      constructor(config) { captured = config; }
      async connect() {}
      async query(sql, params) {
        queries.push({ sql, params });
        return { rows: [], rowCount: 0 };
      }
      async end() { ended = true; }
      on(event, handler) { if (event === "error") poolErrorHandler = handler; }
    }
    const dependencies = {
      dotenv: { config() {} }, pg: { Client: MockConnection, Pool: MockConnection },
      "./db-config": { getDatabaseConfig },
      "node:dns": { setDefaultResultOrder: (value) => dnsCalls.push(value) },
      "node:net": { setDefaultAutoSelectFamily: (value) => familyCalls.push(value) },
    };
    const sandbox = {
      module: { exports: {} }, process: { env: { DATABASE_URL: fixtureUrl } },
      console: { log() {}, table() {} },
      require(name) {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
        return dependencies[name];
      },
    };
    vm.runInNewContext(readFileSync(require.resolve(`./${file}`), "utf8"), sandbox);
    assert.deepEqual({ ...captured, max: undefined }, { ...getDatabaseConfig(fixtureUrl), max: undefined });
    if (file === "db.js") {
      assert.equal(captured.max, 10);
      assert.deepEqual(dnsCalls, ["ipv4first"]);
      assert.deepEqual(familyCalls, [false]);
      assert.equal(captured.ssl.servername, captured.host);
      await sandbox.module.exports.healthCheck();
      await sandbox.module.exports.query("SELECT $1", [123]);
      assert.deepEqual(queries.map((q) => q.sql), ["SELECT 1", "SELECT $1"]);
      assert.doesNotThrow(() => poolErrorHandler({ code: "FIXTURE", message: "synthetic" }));
    } else {
      // Allow each self-starting utility to finish against the mock only.
      await new Promise((resolve) => setImmediate(resolve));
      assert.ok(ended, `${file} closes its mocked connection`);
      assert.ok(queries.length > 0);
    }
  }
});
