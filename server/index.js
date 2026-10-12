const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
require("dotenv").config();
const db = require("./db");

const { generateAnswer, generatePlan } = require("./ai");
const auth = require("./auth");
const rateLimit = require("express-rate-limit");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 5000;

// Browser frontend (Vite dev server) calls the API cross-origin. The allowed
// origin comes from FRONTEND_URL — set to the deployed frontend's origin in
// production; the default keeps local dev on the Vite dev server. credentials:
// true lets the httpOnly session cookie travel between the frontend and the
// API. No wildcard: cookie auth means the origin must always be explicit.
app.use(
  cors({
origin: [
  "http://localhost:5173",
  "https://campus-ai-virid.vercel.app"
],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

/* ============================================================
   Rate limiting
   ------------------------------------------------------------
   Per-process (in-memory) limits keyed by client IP — no database
   involved. When this app is deployed behind a reverse proxy, the
   proxy hop count MUST be configured (`app.set("trust proxy", N)`)
   so each client gets its own bucket; local dev has no proxy, so
   none is set here deliberately. Only the value of N is unknown —
   the hosting platform's docs must confirm the hop count.
   ============================================================ */

// Shared 429 handler: keeps the app-wide { error } shape (Step 43) and tells
// the client when the window resets (Retry-After, in seconds).
function rateLimitExceeded(req, res, _next, options) {
  const reset = req.rateLimit && req.rateLimit.resetTime;
  const retryAfter = reset
    ? Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 1000))
    : Math.ceil(options.windowMs / 1000);
  res.setHeader("Retry-After", String(retryAfter));
  res.status(429).json({ error: "Too many requests, please try again later" });
}

// General API limiter — 300 requests / 15 min / IP. The health check is
// excluded: uptime probes rely on it and it costs nothing. The auth endpoints
// (/api/auth/*) are skipped too: they are already protected by their own
// stricter limiter below, so auth traffic should not also draw from (or be
// blocked by) the general API bucket.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (req) =>
    req.path === "/health" ||
    req.originalUrl === "/api/health" ||
    req.originalUrl.startsWith("/api/auth/"),
  handler: rateLimitExceeded,
  // No proxy in local dev, so IP-keying is correct without trust proxy; this
  // only silences that config validation until deployment configures it.
  validate: { trustProxy: false },
});

// Stricter limiter for the credential endpoints — 60 attempts / 15 min / IP.
// Tight enough to slow brute force, loose enough for normal dev/testing and
// shared office/home IPs. logout + /me are NOT limited (lockout safety); the
// general apiLimiter also skips /api/auth/*, so they stay unthrottled.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitExceeded,
  validate: { trustProxy: false },
});

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/signup", authLimiter);
app.use("/api", apiLimiter);

// Fill req.user from the session cookie when one is present (never errors —
// an absent cookie just means req.user is null). Protected routes use
// auth.requireAuth on top of this.
app.use(auth.attachUser);

app.get("/", (req, res) => {
  res.json({
    message: "Campus AI backend is running!",
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
  });
});

/* ============================================================
   Authentication API
   ============================================================ */

function isValidEmail(value) {
  return (
    typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  );
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

// POST /api/auth/signup — create an account and log straight in.
// Password is hashed with bcrypt before it is ever stored.
app.post("/api/auth/signup", async (req, res) => {
  const { name, email, password } = req.body || {};

  if (typeof name !== "string" || name.trim() === "") {
    return res.status(400).json({ error: "name is required" });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "a valid email is required" });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res
      .status(400)
      .json({ error: "password must be at least 8 characters" });
  }

  const cleanEmail = email.trim().toLowerCase();

  try {
    const existing = await db.query("SELECT id FROM users WHERE email = $1", [
      cleanEmail,
    ]);

    if (existing.rows.length > 0) {
      return res
        .status(409)
        .json({ error: "An account with this email already exists" });
    }

    const passwordHash = await auth.hashPassword(password);
    const result = await db.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email`,
      [name.trim(), cleanEmail, passwordHash]
    );

    const user = result.rows[0];
    auth.setSessionCookie(res, auth.signToken(user));
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    console.log("❌ Failed to create account");
    console.log(error.message);
    res.status(500).json({ error: "Failed to create account" });
  }
});

//  — sign in with email + password.
// The same generic message is returned for a wrong email or a wrong password
// so the endpoint doesn't reveal which accounts exist.
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};

  if (
    typeof email !== "string" ||
    email.trim() === "" ||
    typeof password !== "string" ||
    password === ""
  ) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const cleanEmail = email.trim().toLowerCase();

  try {
    const result = await db.query(
      "SELECT id, name, email, password_hash FROM users WHERE email = $1",
      [cleanEmail]
    );

    const user = result.rows[0];
    if (!user || !(await auth.verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    auth.setSessionCookie(res, auth.signToken(user));
    res.json({ user: publicUser(user) });
  } catch (error) {
    console.log("❌ Failed to log in");
    console.log(error.message);
    res.status(500).json({ error: "Failed to log in" });
  }
});

// POST /api/auth/logout — clear the httpOnly session cookie
app.post("/api/auth/logout", (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ message: "Logged out" });
});

// GET /api/auth/me — who am I? Used on app load to restore a session.
app.get("/api/auth/me", async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "Please log in to continue" });
  }

  try {
    const result = await db.query(
      "SELECT id, name, email FROM users WHERE id = $1",
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Please log in to continue" });
    }
    res.json({ user: publicUser(result.rows[0]) });
  } catch (error) {
    console.log("❌ Failed to load user");
    console.log(error.message);
    res.status(500).json({ error: "Failed to load user" });
  }
});

app.get("/api/courses", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT * FROM courses ORDER BY id"
    );

    res.json(result.rows);
  } catch (error) {
    console.log("❌ Failed to fetch courses");
    console.log(error.message);

    res.status(500).json({
      error: "Failed to fetch courses",
    });
  }
});

/* ============================================================
   Notes API
   ============================================================ */

// GET /api/notes — the logged-in user's notes with their course info,
// newest first. Supports an optional ?course=ID filter that STILL only ever
// returns the logged-in user's own notes (ownership is never bypassed).
app.get("/api/notes", auth.requireAuth, async (req, res) => {
  try {
    const params = [req.user.id];
    let courseClause = "";
    if (req.query.course !== undefined) {
      const courseId = Number(req.query.course);
      if (!Number.isInteger(courseId) || courseId <= 0) {
        return res.status(400).json({ error: "Invalid course filter" });
      }
      courseClause = " AND notes.course_id = $2";
      params.push(courseId);
    }

    const result = await db.query(
      `SELECT notes.id, notes.title, notes.content, notes.course_id, notes.created_at,
              courses.name AS course_name,
              courses.code AS course_code
       FROM notes
       INNER JOIN courses ON courses.id = notes.course_id
       WHERE notes.user_id = $1${courseClause}
       ORDER BY notes.created_at DESC, notes.id DESC`,
      params
    );

    res.json(result.rows);
  } catch (error) {
    console.log("❌ Failed to fetch notes");
    console.log(error.message);

    res.status(500).json({
      error: "Failed to fetch notes",
    });
  }
});

// GET /api/notes/:id — one of the logged-in user's notes with its course info
app.get("/api/notes/:id", auth.requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      error: "Invalid note id",
    });
  }

  try {
    const result = await db.query(
      `SELECT notes.id, notes.title, notes.content, notes.course_id, notes.created_at,
              courses.name AS course_name,
              courses.code AS course_code
       FROM notes
       INNER JOIN courses ON courses.id = notes.course_id
       WHERE notes.id = $1 AND notes.user_id = $2`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Note not found",
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.log("❌ Failed to fetch note");
    console.log(error.message);

    res.status(500).json({
      error: "Failed to fetch note",
    });
  }
});

// POST /api/notes — create a new note owned by the logged-in user
app.post("/api/notes", auth.requireAuth, async (req, res) => {
  const { title, content, course_id } = req.body || {};

  // 1. Validate the three required fields
  if (
    typeof title !== "string" ||
    title.trim() === "" ||
    typeof content !== "string" ||
    content.trim() === "" ||
    !Number.isInteger(course_id) ||
    course_id <= 0
  ) {
    return res.status(400).json({
      error: "title, content and course_id are required",
    });
  }

  try {
    // 2. Validate that the course exists
    const course = await db.query(
      "SELECT id FROM courses WHERE id = $1",
      [course_id]
    );

    if (course.rows.length === 0) {
      return res.status(400).json({
        error: "Course not found",
      });
    }

    // 3. Create the note (owned by the logged-in user)
    const result = await db.query(
      `INSERT INTO notes (title, content, course_id, user_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, content, course_id, created_at`,
      [title.trim(), content.trim(), course_id, req.user.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.log("❌ Failed to create note");
    console.log(error.message);

    res.status(500).json({
      error: "Failed to create note",
    });
  }
});

// DELETE /api/notes/:id — remove one of the logged-in user's notes
app.delete("/api/notes/:id", auth.requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      error: "Invalid note id",
    });
  }

  try {
    const result = await db.query(
      "DELETE FROM notes WHERE id = $1 AND user_id = $2",
      [id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Note not found",
      });
    }

    res.json({
      message: "Note deleted",
    });
  } catch (error) {
    console.log("❌ Failed to delete note");
    console.log(error.message);

    res.status(500).json({
      error: "Failed to delete note",
    });
  }
});

// PATCH /api/notes/:id — update one of the logged-in user's notes
app.patch("/api/notes/:id", auth.requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      error: "Invalid note id",
    });
  }

  const { title, content, course_id } = req.body || {};

  // 1. Validate each provided field (same rules as note creation)
  if (title !== undefined && (typeof title !== "string" || title.trim() === "")) {
    return res.status(400).json({ error: "title must be a non-empty string" });
  }

  if (content !== undefined && (typeof content !== "string" || content.trim() === "")) {
    return res.status(400).json({ error: "content must be a non-empty string" });
  }

  if (
    course_id !== undefined &&
    (!Number.isInteger(course_id) || course_id <= 0)
  ) {
    return res.status(400).json({ error: "course_id must be a positive integer" });
  }

  try {
    // 2. If a course is being set, validate that it exists
    if (course_id !== undefined) {
      const course = await db.query(
        "SELECT id FROM courses WHERE id = $1",
        [course_id]
      );

      if (course.rows.length === 0) {
        return res.status(400).json({ error: "Course not found" });
      }
    }

    // 3. Build the SET clause from whatever fields were provided
    const updates = [];
    const values = [];
    let placeholder = 1;

    if (title !== undefined) {
      updates.push(`title = $${placeholder++}`);
      values.push(title.trim());
    }
    if (content !== undefined) {
      updates.push(`content = $${placeholder++}`);
      values.push(content.trim());
    }
    if (course_id !== undefined) {
      updates.push(`course_id = $${placeholder++}`);
      values.push(course_id);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    // 4. Update the note (only rows owned by the user can be touched)
    const result = await db.query(
      `UPDATE notes
       SET ${updates.join(", ")}
       WHERE id = $${placeholder} AND user_id = $${placeholder + 1}
       RETURNING id`,
      [...values, id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Note not found",
      });
    }

    // 5. Return the updated note with its course info (same enriched shape as GET)
    const updated = await db.query(
      `SELECT notes.id, notes.title, notes.content, notes.course_id, notes.created_at,
              courses.name AS course_name,
              courses.code AS course_code
       FROM notes
       INNER JOIN courses ON courses.id = notes.course_id
       WHERE notes.id = $1 AND notes.user_id = $2`,
      [id, req.user.id]
    );

    res.json(updated.rows[0]);
  } catch (error) {
    console.log("❌ Failed to update note");
    console.log(error.message);

    res.status(500).json({
      error: "Failed to update note",
    });
  }
});

/* ============================================================
   Assignments API
   ============================================================ */

// Small helper: check a due_date string like "2026-09-30"
function isValidDate(value) {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime());
}

// GET /api/assignments — the logged-in user's assignments with course info,
// sorted by due date (assignments without a due date come last).
// Supports an optional ?course=ID filter that STILL only ever returns the
// logged-in user's own assignments (ownership is never bypassed).
app.get("/api/assignments", auth.requireAuth, async (req, res) => {
  try {
    const params = [req.user.id];
    let courseClause = "";
    if (req.query.course !== undefined) {
      const courseId = Number(req.query.course);
      if (!Number.isInteger(courseId) || courseId <= 0) {
        return res.status(400).json({ error: "Invalid course filter" });
      }
      courseClause = " AND assignments.course_id = $2";
      params.push(courseId);
    }

    const result = await db.query(
      `SELECT assignments.id, assignments.title, assignments.description,
              assignments.course_id, assignments.due_date, assignments.status,
              assignments.created_at,
              courses.name AS course_name,
              courses.code AS course_code
       FROM assignments
       INNER JOIN courses ON courses.id = assignments.course_id
       WHERE assignments.user_id = $1${courseClause}
       ORDER BY assignments.due_date NULLS LAST, assignments.id`,
      params
    );

    res.json(result.rows);
  } catch (error) {
    console.log("❌ Failed to fetch assignments");
    console.log(error.message);

    res.status(500).json({
      error: "Failed to fetch assignments",
    });
  }
});

// GET /api/assignments/:id — one of the logged-in user's assignments
app.get("/api/assignments/:id", auth.requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      error: "Invalid assignment id",
    });
  }

  try {
    const result = await db.query(
      `SELECT assignments.id, assignments.title, assignments.description,
              assignments.course_id, assignments.due_date, assignments.status,
              assignments.created_at,
              courses.name AS course_name,
              courses.code AS course_code
       FROM assignments
       INNER JOIN courses ON courses.id = assignments.course_id
       WHERE assignments.id = $1 AND assignments.user_id = $2`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Assignment not found",
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.log("❌ Failed to fetch assignment");
    console.log(error.message);

    res.status(500).json({
      error: "Failed to fetch assignment",
    });
  }
});

// POST /api/assignments — create a new assignment owned by the logged-in user
app.post("/api/assignments", auth.requireAuth, async (req, res) => {
  const { title, description, course_id, due_date, status } = req.body || {};

  // 1. Validate the required fields
  if (
    typeof title !== "string" ||
    title.trim() === "" ||
    !Number.isInteger(course_id) ||
    course_id <= 0
  ) {
    return res.status(400).json({
      error: "title and course_id are required",
    });
  }

  // 2. Validate the optional fields
  if (description !== undefined && typeof description !== "string") {
    return res.status(400).json({ error: "description must be a string" });
  }

  if (due_date !== undefined && !isValidDate(due_date)) {
    return res.status(400).json({ error: "due_date must be a date like 2026-09-30" });
  }

  if (status !== undefined && (typeof status !== "string" || status.trim() === "")) {
    return res.status(400).json({ error: "status must be a non-empty string" });
  }

  try {
    // 3. Validate that the course exists
    const course = await db.query(
      "SELECT id FROM courses WHERE id = $1",
      [course_id]
    );

    if (course.rows.length === 0) {
      return res.status(400).json({
        error: "Course not found",
      });
    }

    // 4. Create the assignment (status defaults to 'Pending',
    //    owned by the logged-in user)
    const result = await db.query(
      `INSERT INTO assignments (title, description, course_id, due_date, status, user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, description, course_id, due_date, status, created_at`,
      [title.trim(), description ?? null, course_id, due_date ?? null, status ?? "Pending", req.user.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.log("❌ Failed to create assignment");
    console.log(error.message);

    res.status(500).json({
      error: "Failed to create assignment",
    });
  }
});

// PATCH /api/assignments/:id — update parts of the logged-in user's assignment
app.patch("/api/assignments/:id", auth.requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      error: "Invalid assignment id",
    });
  }

  const { title, description, course_id, due_date, status } = req.body || {};

  // 1. Validate each provided field
  if (title !== undefined && (typeof title !== "string" || title.trim() === "")) {
    return res.status(400).json({ error: "title must be a non-empty string" });
  }

  if (description !== undefined && typeof description !== "string") {
    return res.status(400).json({ error: "description must be a string" });
  }

  if (
    course_id !== undefined &&
    (!Number.isInteger(course_id) || course_id <= 0)
  ) {
    return res.status(400).json({ error: "course_id must be a positive integer" });
  }

  if (due_date !== undefined && !isValidDate(due_date)) {
    return res.status(400).json({ error: "due_date must be a date like 2026-09-30" });
  }

  if (status !== undefined && (typeof status !== "string" || status.trim() === "")) {
    return res.status(400).json({ error: "status must be a non-empty string" });
  }

  try {
    // 2. If a course is being set, validate that it exists
    if (course_id !== undefined) {
      const course = await db.query(
        "SELECT id FROM courses WHERE id = $1",
        [course_id]
      );

      if (course.rows.length === 0) {
        return res.status(400).json({ error: "Course not found" });
      }
    }

    // 3. Build the SET clause from whatever fields were provided
    const updates = [];
    const values = [];
    let placeholder = 1;

    if (title !== undefined) {
      updates.push(`title = $${placeholder++}`);
      values.push(title.trim());
    }
    if (description !== undefined) {
      updates.push(`description = $${placeholder++}`);
      values.push(description);
    }
    if (course_id !== undefined) {
      updates.push(`course_id = $${placeholder++}`);
      values.push(course_id);
    }
    if (due_date !== undefined) {
      updates.push(`due_date = $${placeholder++}`);
      values.push(due_date);
    }
    if (status !== undefined) {
      updates.push(`status = $${placeholder++}`);
      values.push(status.trim());
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    // 4. Update the assignment (only rows owned by the user can be touched)
    const result = await db.query(
      `UPDATE assignments
       SET ${updates.join(", ")}
       WHERE id = $${placeholder} AND user_id = $${placeholder + 1}
       RETURNING id`,
      [...values, id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Assignment not found",
      });
    }

    // 5. Return the updated assignment with its course info
    const updated = await db.query(
      `SELECT assignments.id, assignments.title, assignments.description,
              assignments.course_id, assignments.due_date, assignments.status,
              assignments.created_at,
              courses.name AS course_name,
              courses.code AS course_code
       FROM assignments
       INNER JOIN courses ON courses.id = assignments.course_id
       WHERE assignments.id = $1 AND assignments.user_id = $2`,
      [id, req.user.id]
    );

    res.json(updated.rows[0]);
  } catch (error) {
    console.log("❌ Failed to update assignment");
    console.log(error.message);

    res.status(500).json({
      error: "Failed to update assignment",
    });
  }
});

// DELETE /api/assignments/:id — remove one of the logged-in user's assignments
app.delete("/api/assignments/:id", auth.requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      error: "Invalid assignment id",
    });
  }

  try {
    const result = await db.query(
      "DELETE FROM assignments WHERE id = $1 AND user_id = $2",
      [id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Assignment not found",
      });
    }

    res.json({
      message: "Assignment deleted",
    });
  } catch (error) {
    console.log("❌ Failed to delete assignment");
    console.log(error.message);

    res.status(500).json({
      error: "Failed to delete assignment",
    });
  }
});

/* ============================================================
   Study Tasks API
   ============================================================ */

// GET /api/study-tasks — the logged-in user's study tasks with course info,
// sorted by study date (tasks without a date come last).
// Supports an optional ?course=ID filter that STILL only ever returns the
// logged-in user's own study tasks (ownership is never bypassed).
app.get("/api/study-tasks", auth.requireAuth, async (req, res) => {
  try {
    const params = [req.user.id];
    let courseClause = "";
    if (req.query.course !== undefined) {
      const courseId = Number(req.query.course);
      if (!Number.isInteger(courseId) || courseId <= 0) {
        return res.status(400).json({ error: "Invalid course filter" });
      }
      courseClause = " AND study_tasks.course_id = $2";
      params.push(courseId);
    }

    const result = await db.query(
      `SELECT study_tasks.id, study_tasks.title, study_tasks.description,
              study_tasks.course_id, study_tasks.study_date, study_tasks.priority,
              study_tasks.status, study_tasks.created_at,
              courses.name AS course_name,
              courses.code AS course_code
       FROM study_tasks
       INNER JOIN courses ON courses.id = study_tasks.course_id
       WHERE study_tasks.user_id = $1${courseClause}
       ORDER BY study_tasks.study_date NULLS LAST, study_tasks.id`,
      params
    );

    res.json(result.rows);
  } catch (error) {
    console.log("❌ Failed to fetch study tasks");
    console.log(error.message);

    res.status(500).json({
      error: "Failed to fetch study tasks",
    });
  }
});

// GET /api/study-tasks/:id — one of the logged-in user's tasks with course info
app.get("/api/study-tasks/:id", auth.requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      error: "Invalid study task id",
    });
  }

  try {
    const result = await db.query(
      `SELECT study_tasks.id, study_tasks.title, study_tasks.description,
              study_tasks.course_id, study_tasks.study_date, study_tasks.priority,
              study_tasks.status, study_tasks.created_at,
              courses.name AS course_name,
              courses.code AS course_code
       FROM study_tasks
       INNER JOIN courses ON courses.id = study_tasks.course_id
       WHERE study_tasks.id = $1 AND study_tasks.user_id = $2`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Study task not found",
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.log("❌ Failed to fetch study task");
    console.log(error.message);

    res.status(500).json({
      error: "Failed to fetch study task",
    });
  }
});

// POST /api/study-tasks — create a new study task owned by the logged-in user
app.post("/api/study-tasks", auth.requireAuth, async (req, res) => {
  const { title, description, course_id, study_date, priority, status } =
    req.body || {};

  // 1. Validate the required fields
  if (
    typeof title !== "string" ||
    title.trim() === "" ||
    !Number.isInteger(course_id) ||
    course_id <= 0
  ) {
    return res.status(400).json({
      error: "title and course_id are required",
    });
  }

  // 2. Validate the optional fields
  if (description !== undefined && typeof description !== "string") {
    return res.status(400).json({ error: "description must be a string" });
  }

  if (study_date !== undefined && !isValidDate(study_date)) {
    return res
      .status(400)
      .json({ error: "study_date must be a date like 2026-09-30" });
  }

  if (
    priority !== undefined &&
    (typeof priority !== "string" || priority.trim() === "")
  ) {
    return res.status(400).json({ error: "priority must be a non-empty string" });
  }

  if (
    status !== undefined &&
    (typeof status !== "string" || status.trim() === "")
  ) {
    return res.status(400).json({ error: "status must be a non-empty string" });
  }

  try {
    // 3. Validate that the course exists
    const course = await db.query(
      "SELECT id FROM courses WHERE id = $1",
      [course_id]
    );

    if (course.rows.length === 0) {
      return res.status(400).json({
        error: "Course not found",
      });
    }

    // 4. Create the task (priority/status default to 'Medium'/'Pending',
    //    owned by the logged-in user)
    const result = await db.query(
      `INSERT INTO study_tasks (title, description, course_id, study_date, priority, status, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, title, description, course_id, study_date, priority, status, created_at`,
      [
        title.trim(),
        description ?? null,
        course_id,
        study_date ?? null,
        priority ?? "Medium",
        status ?? "Pending",
        req.user.id,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.log("❌ Failed to create study task");
    console.log(error.message);

    res.status(500).json({
      error: "Failed to create study task",
    });
  }
});

// PATCH /api/study-tasks/:id — update parts of the logged-in user's task
app.patch("/api/study-tasks/:id", auth.requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      error: "Invalid study task id",
    });
  }

  const { title, description, course_id, study_date, priority, status } =
    req.body || {};

  // 1. Validate each provided field
  if (
    title !== undefined &&
    (typeof title !== "string" || title.trim() === "")
  ) {
    return res.status(400).json({ error: "title must be a non-empty string" });
  }

  if (description !== undefined && typeof description !== "string") {
    return res.status(400).json({ error: "description must be a string" });
  }

  if (
    course_id !== undefined &&
    (!Number.isInteger(course_id) || course_id <= 0)
  ) {
    return res
      .status(400)
      .json({ error: "course_id must be a positive integer" });
  }

  if (study_date !== undefined && !isValidDate(study_date)) {
    return res
      .status(400)
      .json({ error: "study_date must be a date like 2026-09-30" });
  }

  if (
    priority !== undefined &&
    (typeof priority !== "string" || priority.trim() === "")
  ) {
    return res
      .status(400)
      .json({ error: "priority must be a non-empty string" });
  }

  if (
    status !== undefined &&
    (typeof status !== "string" || status.trim() === "")
  ) {
    return res.status(400).json({ error: "status must be a non-empty string" });
  }

  try {
    // 2. If a course is being set, validate that it exists
    if (course_id !== undefined) {
      const course = await db.query(
        "SELECT id FROM courses WHERE id = $1",
        [course_id]
      );

      if (course.rows.length === 0) {
        return res.status(400).json({ error: "Course not found" });
      }
    }

    // 3. Build the SET clause from whatever fields were provided
    const updates = [];
    const values = [];
    let placeholder = 1;

    if (title !== undefined) {
      updates.push(`title = $${placeholder++}`);
      values.push(title.trim());
    }
    if (description !== undefined) {
      updates.push(`description = $${placeholder++}`);
      values.push(description);
    }
    if (course_id !== undefined) {
      updates.push(`course_id = $${placeholder++}`);
      values.push(course_id);
    }
    if (study_date !== undefined) {
      updates.push(`study_date = $${placeholder++}`);
      values.push(study_date);
    }
    if (priority !== undefined) {
      updates.push(`priority = $${placeholder++}`);
      values.push(priority.trim());
    }
    if (status !== undefined) {
      updates.push(`status = $${placeholder++}`);
      values.push(status.trim());
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    // 4. Update the task (only rows owned by the user can be touched)
    const result = await db.query(
      `UPDATE study_tasks
       SET ${updates.join(", ")}
       WHERE id = $${placeholder} AND user_id = $${placeholder + 1}
       RETURNING id`,
      [...values, id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Study task not found",
      });
    }

    // 5. Return the updated task with its course info
    const updated = await db.query(
      `SELECT study_tasks.id, study_tasks.title, study_tasks.description,
              study_tasks.course_id, study_tasks.study_date, study_tasks.priority,
              study_tasks.status, study_tasks.created_at,
              courses.name AS course_name,
              courses.code AS course_code
       FROM study_tasks
       INNER JOIN courses ON courses.id = study_tasks.course_id
       WHERE study_tasks.id = $1 AND study_tasks.user_id = $2`,
      [id, req.user.id]
    );

    res.json(updated.rows[0]);
  } catch (error) {
    console.log("❌ Failed to update study task");
    console.log(error.message);

    res.status(500).json({
      error: "Failed to update study task",
    });
  }
});

// DELETE /api/study-tasks/:id — remove one of the logged-in user's tasks
app.delete("/api/study-tasks/:id", auth.requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      error: "Invalid study task id",
    });
  }

  try {
    const result = await db.query(
      "DELETE FROM study_tasks WHERE id = $1 AND user_id = $2",
      [id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Study task not found",
      });
    }

    res.json({
      message: "Study task deleted",
    });
  } catch (error) {
    console.log("❌ Failed to delete study task");
    console.log(error.message);

    res.status(500).json({
      error: "Failed to delete study task",
    });
  }
});

/* ============================================================
   Resources API
   ============================================================ */

// The small controlled set of resource kinds V1 accepts
const RESOURCE_TYPES = ["Link", "Video", "Article", "PDF"];

// GET /api/resources — the logged-in user's resources with their course info,
// newest first. Supports an optional ?course=ID filter that STILL only ever
// returns the logged-in user's own resources (ownership is never bypassed).
app.get("/api/resources", auth.requireAuth, async (req, res) => {
  try {
    const params = [req.user.id];
    let courseClause = "";
    if (req.query.course !== undefined) {
      const courseId = Number(req.query.course);
      if (!Number.isInteger(courseId) || courseId <= 0) {
        return res.status(400).json({ error: "Invalid course filter" });
      }
      courseClause = " AND resources.course_id = $2";
      params.push(courseId);
    }

    const result = await db.query(
      `SELECT resources.id, resources.title, resources.description, resources.url,
              resources.resource_type, resources.course_id, resources.created_at,
              courses.name AS course_name,
              courses.code AS course_code
       FROM resources
       INNER JOIN courses ON courses.id = resources.course_id
       WHERE resources.user_id = $1${courseClause}
       ORDER BY resources.created_at DESC, resources.id DESC`,
      params
    );

    res.json(result.rows);
  } catch (error) {
    console.log("❌ Failed to fetch resources");
    console.log(error.message);

    res.status(500).json({
      error: "Failed to fetch resources",
    });
  }
});

// GET /api/resources/:id — one of the logged-in user's resources with its course info
app.get("/api/resources/:id", auth.requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      error: "Invalid resource id",
    });
  }

  try {
    const result = await db.query(
      `SELECT resources.id, resources.title, resources.description, resources.url,
              resources.resource_type, resources.course_id, resources.created_at,
              courses.name AS course_name,
              courses.code AS course_code
       FROM resources
       INNER JOIN courses ON courses.id = resources.course_id
       WHERE resources.id = $1 AND resources.user_id = $2`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Resource not found",
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.log("❌ Failed to fetch resource");
    console.log(error.message);

    res.status(500).json({
      error: "Failed to fetch resource",
    });
  }
});

// POST /api/resources — create a new resource owned by the logged-in user
app.post("/api/resources", auth.requireAuth, async (req, res) => {
  const { title, description, url, resource_type, course_id } = req.body || {};

  // 1. Validate the required fields
  if (
    typeof title !== "string" ||
    title.trim() === "" ||
    typeof url !== "string" ||
    url.trim() === "" ||
    !Number.isInteger(course_id) ||
    course_id <= 0 ||
    typeof resource_type !== "string" ||
    !RESOURCE_TYPES.includes(resource_type)
  ) {
    return res.status(400).json({
      error: "title, url, resource_type and course_id are required",
    });
  }

  // 2. Validate the optional description and keep URLs on http(s) only
  if (description !== undefined && typeof description !== "string") {
    return res.status(400).json({ error: "description must be a string" });
  }

  if (!/^https?:\/\/\S+$/i.test(url.trim())) {
    return res.status(400).json({
      error: "url must be a valid http(s) URL",
    });
  }

  try {
    // 3. Validate that the course exists
    const course = await db.query(
      "SELECT id FROM courses WHERE id = $1",
      [course_id]
    );

    if (course.rows.length === 0) {
      return res.status(400).json({
        error: "Course not found",
      });
    }

    // 4. Create the resource (owned by the logged-in user)
    const result = await db.query(
      `INSERT INTO resources (title, description, url, resource_type, course_id, user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [title.trim(), description ?? null, url.trim(), resource_type, course_id, req.user.id]
    );

    // 5. Return the created resource in the same enriched shape as GET
    const created = await db.query(
      `SELECT resources.id, resources.title, resources.description, resources.url,
              resources.resource_type, resources.course_id, resources.created_at,
              courses.name AS course_name,
              courses.code AS course_code
       FROM resources
       INNER JOIN courses ON courses.id = resources.course_id
       WHERE resources.id = $1 AND resources.user_id = $2`,
      [result.rows[0].id, req.user.id]
    );

    res.status(201).json(created.rows[0]);
  } catch (error) {
    console.log("❌ Failed to create resource");
    console.log(error.message);

    res.status(500).json({
      error: "Failed to create resource",
    });
  }
});

// PATCH /api/resources/:id — update one of the logged-in user's resources
app.patch("/api/resources/:id", auth.requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      error: "Invalid resource id",
    });
  }

  const { title, description, url, resource_type, course_id } = req.body || {};

  // 1. Validate each provided field (same rules as resource creation)
  if (title !== undefined && (typeof title !== "string" || title.trim() === "")) {
    return res.status(400).json({ error: "title must be a non-empty string" });
  }

  if (description !== undefined && typeof description !== "string") {
    return res.status(400).json({ error: "description must be a string" });
  }

  if (url !== undefined && (typeof url !== "string" || url.trim() === "")) {
    return res.status(400).json({ error: "url must be a non-empty string" });
  }

  if (url !== undefined && !/^https?:\/\/\S+$/i.test(url.trim())) {
    return res.status(400).json({
      error: "url must be a valid http(s) URL",
    });
  }

  if (
    resource_type !== undefined &&
    (typeof resource_type !== "string" || !RESOURCE_TYPES.includes(resource_type))
  ) {
    return res.status(400).json({
      error: `resource_type must be one of ${RESOURCE_TYPES.join(", ")}`,
    });
  }

  if (
    course_id !== undefined &&
    (!Number.isInteger(course_id) || course_id <= 0)
  ) {
    return res.status(400).json({ error: "course_id must be a positive integer" });
  }

  try {
    // 2. If a course is being set, validate that it exists
    if (course_id !== undefined) {
      const course = await db.query(
        "SELECT id FROM courses WHERE id = $1",
        [course_id]
      );

      if (course.rows.length === 0) {
        return res.status(400).json({ error: "Course not found" });
      }
    }

    // 3. Build the SET clause from whatever fields were provided
    const updates = [];
    const values = [];
    let placeholder = 1;

    if (title !== undefined) {
      updates.push(`title = $${placeholder++}`);
      values.push(title.trim());
    }
    if (description !== undefined) {
      updates.push(`description = $${placeholder++}`);
      values.push(description.trim() || null);
    }
    if (url !== undefined) {
      updates.push(`url = $${placeholder++}`);
      values.push(url.trim());
    }
    if (resource_type !== undefined) {
      updates.push(`resource_type = $${placeholder++}`);
      values.push(resource_type);
    }
    if (course_id !== undefined) {
      updates.push(`course_id = $${placeholder++}`);
      values.push(course_id);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    // 4. Update the resource (only rows owned by the user can be touched)
    const result = await db.query(
      `UPDATE resources
       SET ${updates.join(", ")}
       WHERE id = $${placeholder} AND user_id = $${placeholder + 1}
       RETURNING id`,
      [...values, id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Resource not found",
      });
    }

    // 5. Return the updated resource with its course info (same enriched shape as GET)
    const updated = await db.query(
      `SELECT resources.id, resources.title, resources.description, resources.url,
              resources.resource_type, resources.course_id, resources.created_at,
              courses.name AS course_name,
              courses.code AS course_code
       FROM resources
       INNER JOIN courses ON courses.id = resources.course_id
       WHERE resources.id = $1 AND resources.user_id = $2`,
      [id, req.user.id]
    );

    res.json(updated.rows[0]);
  } catch (error) {
    console.log("❌ Failed to update resource");
    console.log(error.message);

    res.status(500).json({
      error: "Failed to update resource",
    });
  }
});

// DELETE /api/resources/:id — remove one of the logged-in user's resources
app.delete("/api/resources/:id", auth.requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      error: "Invalid resource id",
    });
  }

  try {
    const result = await db.query(
      "DELETE FROM resources WHERE id = $1 AND user_id = $2",
      [id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Resource not found",
      });
    }

    res.json({
      message: "Resource deleted",
    });
  } catch (error) {
    console.log("❌ Failed to delete resource");
    console.log(error.message);

    res.status(500).json({
      error: "Failed to delete resource",
    });
  }
});

/* ============================================================
   AI Assistant API
   ============================================================ */

// POST /api/ai/ask — ask the AI assistant a study question.
// Requires a logged-in user (protects the Gemini key's usage allowance).
// The real AI provider lives in server/ai.js. No API keys here.
app.post("/api/ai/ask", auth.requireAuth, async (req, res) => {
  const { question } = req.body || {};

  // 1. Validate the question
  if (typeof question !== "string" || question.trim() === "") {
    return res.status(400).json({
      error: "question is required",
    });
  }

  try {
    // 2. Ask the AI layer (Google Gemini)
    const answer = await generateAnswer(question.trim());

    res.json({
      answer,
    });
  } catch (error) {
    console.log("❌ AI request failed");
    console.log(error.message);

    // Pass along the clear message from ai.js (e.g. a missing API key)
    res.status(500).json({
      error: error.message || "Failed to get an answer",
    });
  }
});

// A study-plan request longer than this is far beyond a natural-language
// description of exam + material + hours — reject it before it reaches Gemini.
const MAX_PLAN_REQUEST_LENGTH = 2000;

// POST /api/ai/plan — generate a study plan for the logged-in user, WITHOUT
// saving anything.
// ------------------------------------------------------------
// The route stays thin: validate the request, load the authenticated user's
// own courses + assignments, hand them to generatePlan (server/ai.js), and
// return the validated sessions. The client never supplies course/assignment
// context or a user id — everything comes from req.user.id, so another
// user's data can never leak in. Sessions are returned, never written.
// The Step 45 general API limiter already covers this path (app.use("/api",
// apiLimiter)); no extra limiter is added.
app.post("/api/ai/plan", auth.requireAuth, async (req, res) => {
  // 1. Validate the natural-language request
  const { request } = req.body || {};
  if (typeof request !== "string") {
    return res.status(400).json({ error: "request must be a string" });
  }
  const trimmedRequest = request.trim();
  if (trimmedRequest === "") {
    return res.status(400).json({ error: "request is required" });
  }
  if (trimmedRequest.length > MAX_PLAN_REQUEST_LENGTH) {
    return res.status(400).json({
      error: `request must be at most ${MAX_PLAN_REQUEST_LENGTH} characters`,
    });
  }

  // 2. Load the user's own context from the database. Courses are a shared
  //    catalog (the same query every course dropdown uses); assignments are
  //    strictly scoped to req.user.id. All queries are parameterized.
  let courses;
  let assignments;
  try {
    const [courseRows, assignmentRows] = await Promise.all([
      db.query("SELECT id, code, name FROM courses ORDER BY id"),
      db.query(
        "SELECT id, title, course_id, due_date, status FROM assignments WHERE user_id = $1 ORDER BY due_date NULLS LAST, id",
        [req.user.id]
      ),
    ]);
    courses = courseRows.rows;
    assignments = assignmentRows.rows;
  } catch (error) {
    console.log("❌ Failed to load study plan context");
    console.log(error.message);
    return res
      .status(500)
      .json({ error: "Failed to load your study context" });
  }

  // 3. Ask the AI layer. generatePlan does the Gemini call + strict plan
  //    validation and never writes to the database — and neither does this
  //    route. Only curated ai.js messages are surfaced to the client.
  try {
    const sessions = await generatePlan({ courses, assignments }, trimmedRequest);
    return res.json({ sessions });
  } catch (error) {
    console.log("❌ Failed to generate study plan");
    console.log(error.message);
    return res
      .status(500)
      .json({ error: error.message || "Failed to generate study plan" });
  }
});

/* ============================================================
   Not-found + error handling (JSON everywhere)
   ------------------------------------------------------------
   Every route above is matched first. Anything unknown falls
   through to the 404 handler, and any error thrown by middleware
   or an unguarded route lands in the final error middleware below.
   Both use the same { error: "..." } shape as the route-level
   catches, so API clients always get JSON — never an HTML page or
   a stack trace.
   ============================================================ */

// Unknown route → JSON 404
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Final error middleware → JSON, never a stack trace. Respects the error's
// own status when set (e.g. the JSON body parser flags a malformed body as
// 400), otherwise 500. Diagnostic details are logged server-side only — the
// client never sees SQL details, connection strings or other internals.
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const raw = err && (Number.isInteger(err.status) ? err.status : err.statusCode);
  const status = typeof raw === "number" && raw >= 400 && raw <= 599 ? raw : 500;

  console.log("❌ Unhandled request error");
  console.log(err && err.message ? err.message : String(err));

  res.status(status).json({
    error: status >= 500 ? "Internal server error" : "Bad request",
  });
});

async function startServer() {
  try {
    await db.healthCheck();
    console.log("✅ Database connected!");

    app.listen(PORT, () => {
      console.log(`Campus AI server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    // Fail fast: a server that cannot reach its database must not keep
    // running — a supervisor would otherwise see a "healthy" process that
    // serves nothing. Exit non-zero so a restart policy kicks in.
    console.log("❌ Database connection failed");
    console.log(error.message);
    process.exit(1);
  }
}

startServer();