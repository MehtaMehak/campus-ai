const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const { validateInput } = require("./input-validation");

// Execute the real route handlers with isolated dependencies. No .env file,
// network listener, production auth, AI client, or PostgreSQL client is loaded.
function fixture(query = async () => ({ rows: [{ id: 1 }], rowCount: 1 })) {
  const routes = new Map();
  const calls = [];
  const app = { set() {}, use() {}, listen(_port, cb) { cb(); } };
  for (const method of ["get", "post", "patch", "delete"]) {
    app[method] = (path, ...handlers) => routes.set(`${method} ${path}`, handlers);
  }
  const noop = (_req, _res, next) => next();
  const dependencies = {
    express: Object.assign(() => app, { json: () => noop }),
    cors: () => noop, "cookie-parser": () => noop,
    dotenv: { config() {} },
    "./db": { healthCheck: async () => {}, query: async (sql, params) => {
      calls.push({ sql, params });
      return query(sql, params);
    } },
    "./ai": {},
    "./auth": { requireAuth: noop, attachUser: noop, hashPassword: async () => "fixture-hash", signToken: () => "fixture-token", setSessionCookie() {} },
    "express-rate-limit": () => noop,
    "./request-security": { allowedOrigins: [], requireTrustedOrigin: noop },
    "./input-validation": { validateInput },
  };
  vm.runInNewContext(readFileSync(require.resolve("./index"), "utf8"), {
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    process: { env: {}, exit() { throw new Error("Unexpected startup failure"); } },
    console: { log() {} },
  });
  return {
    calls,
    async request(method, path, body) {
      const req = { body: { ...body }, params: { id: "1" }, user: { id: 7 } };
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
      const handlers = routes.get(`${method} ${path}`);
      assert.ok(handlers, `Unknown test route: ${path}`);
      async function run(index) {
        if (!handlers[index]) return;
        let continuation;
        await handlers[index](req, res, () => {
          continuation = run(index + 1);
          return continuation;
        });
        await continuation;
      }
      await run(0);
      return res;
    },
  };
}

const kinds = ["notes", "assignments", "study-tasks", "resources"];
function valid(kind) {
  return { title: "Fixture", course_id: 1,
    ...(kind === "notes" ? { content: "Note" } : {}),
    ...(kind === "resources" ? { url: "https://example.invalid", resource_type: "Link" } : {}),
  };
}

test("impossible dates return 400 on assignment/task create and update before SQL", async () => {
  for (const kind of ["assignments", "study-tasks"]) {
    const field = kind === "assignments" ? "due_date" : "study_date";
    for (const method of ["post", "patch"]) {
      for (const value of ["2026-02-30", "2025-02-29", "1900-02-29", "0000-01-01", "2026-04-31", "2026-13-01", "2026-00-10", "2026-01-00", "2026-2-01", "bad", null]) {
        const f = fixture();
        const result = await f.request(method, `/api/${kind}${method === "patch" ? "/:id" : ""}`, { ...valid(kind), [field]: value });
        assert.equal(result.statusCode, 400, `${method} ${kind}: ${value}`);
        assert.equal(f.calls.length, 0);
      }
    }
  }
});

test("valid leap dates and omitted dates remain supported", async () => {
  for (const kind of ["assignments", "study-tasks"]) {
    const field = kind === "assignments" ? "due_date" : "study_date";
    for (const method of ["post", "patch"]) {
      for (const date of [undefined, "2024-02-29", "2000-02-29", "2026-02-28"]) {
        const f = fixture();
        const body = { ...valid(kind), ...(date === undefined ? {} : { [field]: date }) };
        assert.equal((await f.request(method, `/api/${kind}${method === "patch" ? "/:id" : ""}`, body)).statusCode, method === "post" ? 201 : 200);
      }
    }
  }
});

test("unsupported enum values return 400 on create and update without SQL", async () => {
  for (const kind of ["assignments", "study-tasks"]) {
    for (const method of ["post", "patch"]) {
      const fields = kind === "assignments" ? ["status"] : ["status", "priority"];
      for (const field of fields) {
        for (const value of ["urgent", "pending", "high", "", null, 123]) {
          const f = fixture();
          assert.equal((await f.request(method, `/api/${kind}${method === "patch" ? "/:id" : ""}`, { ...valid(kind), [field]: value })).statusCode, 400);
          assert.equal(f.calls.length, 0);
        }
      }
    }
  }
});

test("frontend statuses, priorities and defaults keep their current contract", async () => {
  for (const kind of ["assignments", "study-tasks"]) {
    for (const method of ["post", "patch"]) {
      const statuses = kind === "assignments" ? ["Pending", "In Progress", "Completed"] : ["Pending", "Completed"];
      for (const status of statuses) {
        for (const priority of kind === "study-tasks" ? ["Low", "Medium", "High"] : [undefined]) {
          const f = fixture();
          assert.equal((await f.request(method, `/api/${kind}${method === "patch" ? "/:id" : ""}`, { ...valid(kind), status, ...(priority ? { priority } : {}) })).statusCode, method === "post" ? 201 : 200);
        }
      }
    }
    const f = fixture();
    assert.equal((await f.request("post", `/api/${kind}`, valid(kind))).statusCode, 201);
    const insert = f.calls.find((call) => call.sql.includes("INSERT INTO"));
    assert.ok(insert.params.includes("Pending"));
    if (kind === "study-tasks") assert.ok(insert.params.includes("Medium"));
  }
});

test("title boundaries match VARCHAR(200), including Unicode and trimming", async () => {
  for (const kind of kinds) {
    for (const method of ["post", "patch"]) {
      for (const [title, expected] of [["x".repeat(201), 400], ["😀".repeat(201), 400], ["x".repeat(200), method === "post" ? 201 : 200], [" 😀".repeat(100).trim(), method === "post" ? 201 : 200], [" " + "x".repeat(200) + " ", method === "post" ? 201 : 200]]) {
        const f = fixture();
        assert.equal((await f.request(method, `/api/${kind}${method === "patch" ? "/:id" : ""}`, { ...valid(kind), title })).statusCode, expected);
        if (expected === 400) assert.equal(f.calls.length, 0);
      }
    }
  }
});

const signup = { name: "Fixture", email: "fixture@example.invalid", password: "synthetic-test-password" };
test("signup name/email and login email enforce schema limits before SQL", async () => {
  for (const body of [{ ...signup, name: "x".repeat(101) }, { ...signup, email: "x".repeat(140) + "@example.invalid" }]) {
    const f = fixture();
    assert.equal((await f.request("post", "/api/auth/signup", body)).statusCode, 400);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  assert.equal((await f.request("post", "/api/auth/login", { email: "x".repeat(151), password: "fixture" })).statusCode, 400);
  assert.equal(f.calls.length, 0);
  const boundary = fixture(async (sql) => ({ rows: sql.includes("INSERT") ? [{ id: 1, ...signup }] : [] }));
  const email = "x".repeat(138) + "@example.com";
  assert.equal(email.length, 150);
  assert.equal((await boundary.request("post", "/api/auth/signup", { ...signup, name: "😀".repeat(100), email })).statusCode, 201);
});

test("concurrent signup conflicts return 201 and 409 even when both prechecks miss", async () => {
  let checks = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  let inserted = false;
  const f = fixture(async (sql) => {
    if (sql.startsWith("SELECT")) {
      if (++checks === 2) release();
      await barrier;
      return { rows: [] };
    }
    assert.match(sql, /ON CONFLICT \(email\) DO NOTHING/);
    if (inserted) return { rows: [] };
    inserted = true;
    return { rows: [{ id: 1, ...signup }] };
  });
  const results = await Promise.all([f.request("post", "/api/auth/signup", signup), f.request("post", "/api/auth/signup", signup)]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409]);
});

test("existing signup conflicts stay 409 and unrelated database errors stay 500", async () => {
  assert.equal((await fixture().request("post", "/api/auth/signup", signup)).statusCode, 409);
  const f = fixture(async () => { throw new Error("synthetic database failure"); });
  assert.equal((await f.request("post", "/api/auth/signup", signup)).statusCode, 500);
});

test("editing a title does not validate or rewrite legacy status/priority values", async () => {
  const f = fixture(async () => ({ rows: [{ id: 1, status: "Legacy", priority: "medium" }], rowCount: 1 }));
  const result = await f.request("patch", "/api/study-tasks/:id", { title: "Updated title" });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, "Legacy");
  assert.equal(result.body.priority, "medium");
  const update = f.calls.find((call) => call.sql.includes("UPDATE study_tasks"));
  assert.ok(update);
  assert.doesNotMatch(update.sql, /status\s*=|priority\s*=/);
});
