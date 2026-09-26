/* ============================================================
   AI provider layer
   ------------------------------------------------------------
   This is the ONLY place that talks to an AI provider. The routes
   in index.js stay simple: the AI Assistant passes a question in
   and gets an answer string back; the Study Planner passes the
   student's request + courses/assignments in and gets validated
   plan sessions back.

   The API key is read from server/.env (GEMINI_API_KEY) via
   dotenv — it is never exposed to the React frontend.
   ============================================================ */

require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");

// Current Gemini model supported by the @google/genai SDK.
// Swap this constant if you ever want to try another model.
const GEMINI_MODEL = "gemini-3.6-flash";

// Gemini occasionally answers with a transient 503 ("high demand") or 429.
// A brief delay gives a short spike time to clear; we cap at two attempts so
// a sustained overload still fails fast with a clear message.
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Work out WHY Gemini rejected the call, so transient failures (the common
// 503 "experiencing high demand" case) get retried and the client gets a
// truthful message instead of a vague one.
function classifyGeminiError(error) {
  const text = String((error && (error.message || error)) || "");
  const codeMatch = text.match(/"code"\s*:\s*(\d+)/);
  const code = codeMatch ? Number(codeMatch[1]) : null;

  if (code === 429 || /RESOURCE_EXHAUSTED|quota|daily limit/i.test(text)) {
    return "quota";
  }
  if (
    code === 503 ||
    code >= 500 ||
    /UNAVAILABLE|high demand|temporarily busy|try again later/i.test(text)
  ) {
    return "busy";
  }
  return "other";
}

// Generate an answer for a study question using Google Gemini.
// Returns a Promise that resolves to a string.
async function generateAnswer(question) {
  // 1. Make sure we have a key before calling the API
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is missing in the server .env file. Add it to enable the AI Assistant."
    );
  }

  // 2. Ask Gemini. One client is enough for every request.
  const ai = new GoogleGenAI({ apiKey });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: question,
      });

      // The SDK puts the finished text in response.text
      return response.text || "The AI assistant returned an empty answer.";
    } catch (error) {
      // Log the real reason on the server (never sent to the browser)
      console.log(`❌ Gemini request failed (attempt ${attempt}/${MAX_ATTEMPTS})`);
      console.log(error.message);

      const kind = classifyGeminiError(error);

      // Transient overload — wait briefly and try again
      if (kind === "busy" && attempt < MAX_ATTEMPTS) {
        console.log(`→ Gemini is overloaded; retrying in ${RETRY_DELAY_MS}ms…`);
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      // Keep the client-facing message truthful and clear
      if (kind === "busy") {
        throw new Error(
          "Gemini is experiencing high demand right now. Please try again in a few moments."
        );
      }
      if (kind === "quota") {
        throw new Error(
          "The Gemini daily usage limit for this API key was reached. Please try again later."
        );
      }
      throw new Error("The AI service had an unexpected error. Please try again.");
    }
  }
}

/* ============================================================
   AI Study Planner: structured plan generation
   ------------------------------------------------------------
   generatePlan(context, request) is backend-only: it turns a
   student's natural-language plan request plus their courses /
   assignments into a validated list of study sessions. It never
   writes to the database — the caller decides what to do with
   the sessions.
   ============================================================ */

// A generated plan may contain at most this many sessions. The prompt also
// asks Gemini to stay well under it; this is the hard cap that stops a
// runaway plan from ever reaching the student.
const MAX_PLAN_SESSIONS = 20;

// The only priorities the planner understands (lowercase). The UI's
// Low/Medium/High options map onto these exactly.
const PLAN_PRIORITIES = new Set(["low", "medium", "high"]);

// Request JSON mode: Gemini is asked to return exactly this object shape.
// Extra fields are still stripped by parsePlanSessions (see below), so
// nothing arbitrary can leak through into the sessions.
const PLAN_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    sessions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          courseId: { type: "INTEGER" },
          date: { type: "STRING" },
          priority: {
            type: "STRING",
            format: "enum",
            enum: ["low", "medium", "high"],
          },
        },
        required: ["title", "courseId", "date", "priority"],
      },
    },
  },
  required: ["sessions"],
};

// Mark validation failures distinctly so the retry loop knows a malformed
// plan is a "reject now" outcome, not a transient Gemini problem worth
// re-calling (re-calling cannot fix a deterministic shape error).
function planError(message) {
  const error = new Error(message);
  error.isPlanValidationError = true;
  return error;
}

// Check a date string like "2026-09-30" — the same convention the backend
// routes use (regex, then a real calendar date anchored to UTC so the check
// never depends on the server's timezone), plus a round-trip check so the
// parser cannot silently normalise an invalid calendar date such as
// "2026-02-30" (which engines otherwise read as 2026-03-02).
function isValidDate(value) {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(value + "T00:00:00Z");
  if (Number.isNaN(date.getTime())) return false;

  return date.toISOString().slice(0, 10) === value;
}

// Pull a JSON object out of Gemini's text reply. Gemini sometimes wraps the
// JSON in ```json … ``` fences or pads it with a sentence, so a bare JSON
// object anywhere in the reply is accepted — anything else is rejected.
function extractJsonObject(text) {
  if (typeof text !== "string" || text.trim() === "") return null;

  let candidate = text.trim();

  // 1. Strip a ```json markdown code fence if one is present.
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidate = fence[1].trim();

  // 2. If the whole reply is a JSON object, parse it directly.
  try {
    return JSON.parse(candidate);
  } catch {
    /* fall through to the block-extraction attempt */
  }

  // 3. Otherwise try the first balanced-looking { … } block in the reply.
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

// Turn one raw session row into a validated session. Only the four expected
// fields survive — anything extra Gemini returned is deliberately dropped.
function parsePlanSession(raw, courseIds, index) {
  const label = `Session ${index + 1}`;

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw planError(`${label} is malformed.`);
  }

  if (typeof raw.title !== "string" || raw.title.trim() === "") {
    throw planError(`${label} is missing a title.`);
  }
  const title = raw.title.trim();

  const courseId =
    typeof raw.courseId === "number" ||
    (typeof raw.courseId === "string" && raw.courseId.trim() !== "")
      ? Number(raw.courseId)
      : NaN;
  if (!Number.isInteger(courseId) || courseId <= 0 || !courseIds.has(courseId)) {
    throw planError(
      `${label} refers to a course that is not in the student's context.`
    );
  }

  if (!isValidDate(raw.date)) {
    throw planError(`${label} has an invalid date (expected YYYY-MM-DD).`);
  }

  const priority =
    typeof raw.priority === "string" ? raw.priority.toLowerCase() : "";
  if (!PLAN_PRIORITIES.has(priority)) {
    throw planError(
      `${label} has an invalid priority (expected low, medium or high).`
    );
  }

  return { title, courseId, date: raw.date, priority };
}

// Parse + strictly validate Gemini's reply into a sessions array.
// Throws an isPlanValidationError when the reply is not a usable plan.
function parsePlanSessions(text, context) {
  const courseIds = new Set(
    (context && Array.isArray(context.courses) ? context.courses : [])
      .map((course) => Number(course && course.id))
      .filter((id) => Number.isInteger(id) && id > 0)
  );

  const data = extractJsonObject(text);
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw planError("The AI returned an unreadable study plan.");
  }

  if (!Array.isArray(data.sessions)) {
    throw planError("The AI returned a study plan without a session list.");
  }

  if (data.sessions.length === 0) {
    throw planError("The AI returned an empty study plan.");
  }

  if (data.sessions.length > MAX_PLAN_SESSIONS) {
    throw planError(
      `The AI returned ${data.sessions.length} sessions — too many to review. Try a more focused request.`
    );
  }

  return data.sessions.map((raw, index) =>
    parsePlanSession(raw, courseIds, index)
  );
}

// Build the instruction payload for Gemini: the student's request plus ONLY
// the courses/assignments supplied by the caller.
function buildPlanPrompt(context, request) {
  const courseLines = context.courses.map(
    (course) =>
      `- id=${course.id}, code=${course.code || "—"}, name=${course.name || "Unnamed course"}`
  );

  const assignments = Array.isArray(context.assignments)
    ? context.assignments
    : [];
  const pendingAssignments = assignments.filter((a) => a.status === "Pending");
  const assignmentLines =
    pendingAssignments.length > 0
      ? pendingAssignments.map(
          (a) =>
            `- ${a.title || "Untitled assignment"} (course id=${a.course_id}, due ${a.due_date || "no date"})`
        )
      : ["- None"];

  return [
    "You are the Campus AI Study Planner for a university student.",
    "",
    "Your job is to turn the student's study-plan request into a concrete, realistic list of study sessions.",
    "",
    "RULES",
    "- Use ONLY the courses listed below. NEVER invent a course or a course id.",
    "- Every session must reference exactly one of the listed course ids.",
    "- Create practical sessions based on the student's request (exam date, material, hours available per day).",
    "- Spread sessions across the available days rather than packing many onto one day. Aim for at most 15 sessions.",
    "- `date` must be a real calendar date in YYYY-MM-DD format.",
    "- `priority` must be exactly one of: low, medium, high.",
    "- `title` should be a short, specific session name (for example \"Chapter 1 — Introduction\").",
    "- Return ONLY the requested JSON object. No markdown fences, no extra text, no extra fields.",
    "",
    "COURSES (the only ones you may use)",
    ...courseLines,
    "",
    "UPCOMING ASSIGNMENTS / EXAMS (context only — do not invent new ones)",
    ...assignmentLines,
    "",
    "STUDENT'S REQUEST",
    request,
    "",
    'Return a JSON object of the exact shape: { "sessions": [ { "title": "...", "courseId": 1, "date": "YYYY-MM-DD", "priority": "medium" } ] }',
  ].join("\n");
}

// Generate a validated study plan for the student.
// context: { courses: [{id, code, name}], assignments: [{id, title, course_id, due_date, status}] }
// request: the student's natural-language plan request
// Returns: [{ title, courseId, date, priority }, ...] — validated, bounded,
// never written to the database.
async function generatePlan(context, request) {
  // 1. A plan is meaningless without courses to attach to — and Gemini must
  //    never be allowed to invent them. Checked before any API call.
  const courses = Array.isArray(context && context.courses)
    ? context.courses
    : [];
  if (courses.length === 0) {
    throw new Error("Add at least one course before generating a study plan.");
  }
  if (typeof request !== "string" || request.trim() === "") {
    throw new Error("Describe what you want to plan first.");
  }

  // 2. Make sure we have a key before calling the API (same gate as the
  //    AI Assistant path).
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is missing in the server .env file. Add it to enable the AI Assistant."
    );
  }

  // 3. Ask Gemini for the structured plan. One client is enough for every request.
  const ai = new GoogleGenAI({ apiKey });
  const contents = buildPlanPrompt(context, request.trim());

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config: {
          responseMimeType: "application/json",
          responseSchema: PLAN_RESPONSE_SCHEMA,
        },
      });

      // Parse + strictly validate. A malformed plan fails fast here — it is
      // not a transient Gemini problem and retrying would not help.
      return parsePlanSessions(response.text || "", context);
    } catch (error) {
      if (error && error.isPlanValidationError) throw error;

      // Log the real reason on the server (never sent to the browser)
      console.log(`❌ Gemini plan request failed (attempt ${attempt}/${MAX_ATTEMPTS})`);
      console.log(error.message);

      // Reuse the same classification as the AI Assistant, with a timeout
      // treated as transient so a slow Gemini still gets its one retry.
      const kind = classifyGeminiError(error);
      const text = String((error && (error.message || error)) || "");
      const transient =
        kind === "busy" ||
        /DEADLINE_EXCEEDED|ETIMEDOUT|timed ?out|fetch failed|ECONNRESET/i.test(
          text
        );

      if (transient && attempt < MAX_ATTEMPTS) {
        console.log(`→ Gemini is overloaded; retrying in ${RETRY_DELAY_MS}ms…`);
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      // Keep the client-facing message truthful and clear
      if (kind === "busy") {
        throw new Error(
          "Gemini is experiencing high demand right now. Please try again in a few moments."
        );
      }
      if (kind === "quota") {
        throw new Error(
          "The Gemini daily usage limit for this API key was reached. Please try again later."
        );
      }
      throw new Error("The AI service had an unexpected error. Please try again.");
    }
  }
}

module.exports = { generateAnswer, generatePlan, parsePlanSessions };