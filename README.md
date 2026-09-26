# Campus AI

A student study desk — courses, notes, assignments, a study planner and an AI
assistant — built with React (Vite) on the front, Express on the back, and
PostgreSQL (Neon) for storage.

> **Accounts:** the app now requires a student account. Sign up is free and
> instant; your notes, assignments and study tasks are private to your account.

---

## Project layout

```
campus-ai/
├─ client/   React + Vite single-page app  (dev server on :5173)
├─ server/   Express API + DB migration    (API on :5000)
└─ README.md
```

## Prerequisites

- Node.js 18+ (tested on Node 24)
- A Neon PostgreSQL database (or any Postgres) — you only need the connection string
- A Google AI Studio API key for the AI assistant

## 1. Server setup

```bash
cd server
npm install
```

Create `server/.env` with these variables (never commit it):

| Variable         | Required | Purpose                                             |
| ---------------- | :------: | --------------------------------------------------- |
| `DATABASE_URL`   | ✅       | PostgreSQL connection string (`postgresql://…`)     |
| `GEMINI_API_KEY` | ✅       | Google AI Studio key used by the AI assistant       |
| `JWT_SECRET`     | ✅       | Secret used to sign session cookies. Generate one with: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |

Then create/migrate the schema and seed the public data:

```bash
node setup-db.js     # idempotent — safe to re-run
```

Start the API:

```bash
npm start            # = node index.js  → http://localhost:5000
```

`setup-db.js` creates the tables (`users`, `courses`, `notes`, `assignments`,
`study_tasks`), seeds the public courses, adds the legacy placeholder owner and
backfills `user_id` ownership on all existing rows. It does not drop anything.

## 2. Client setup

```bash
cd client
npm install
npm run dev          # → http://localhost:5173
```

The client talks to the API on `http://localhost:5000` and sends the session
cookie with every request. Production build + lint:

```bash
npm run build
npm run lint
```

## Authentication

- Passwords are hashed with **bcryptjs** — plaintext is never stored or logged.
- On signup/login the server sets an **httpOnly** cookie, `campus_session`
  (SameSite=Lax, 7-day expiry, `secure:false` on the local HTTP dev setup).
- The cookie carries a signed JWT; every protected route verifies it and scopes
  all queries to the signed-in `user_id`.
- Sign out clears the cookie server-side.

### API endpoints

| Method | Path                  | Auth  | Purpose                                  |
| ------ | --------------------- | :---: | ---------------------------------------- |
| GET    | `/api/health`         | —     | Liveness check                           |
| GET    | `/api/courses`        | —     | Public course catalogue                  |
| POST   | `/api/auth/signup`    | —     | Create account (name, email, password)   |
| POST   | `/api/auth/login`     | —     | Sign in → sets session cookie            |
| POST   | `/api/auth/logout`    | —     | Clear session                            |
| GET    | `/api/auth/me`        | ✅    | Current user (restore session on reload) |
| GET/POST | `/api/notes`        | ✅    | List / create my notes                   |
| GET    | `/api/notes/:id`      | ✅    | My note (404 if it isn't mine)           |
| GET/POST | `/api/assignments`  | ✅    | List / create my assignments             |
| PATCH/DELETE | `/api/assignments/:id` | ✅ | Update / delete my assignment |
| GET/POST | `/api/study-tasks`  | ✅    | List / create my study tasks             |
| PATCH/DELETE | `/api/study-tasks/:id` | ✅  | Update / delete my task                  |
| POST   | `/api/ai/ask`         | ✅    | Ask the AI assistant                     |

Any request that is not signed in (or touches another user's row) returns
`401`/`404` — traffic between users is fully isolated.

## Demo / legacy data

The database ships with a small legacy payload (2 notes, 1 assignment) owned by
a **placeholder account** `legacy@campus.local`. It has no usable password —
it exists purely so the old rows have a valid owner and is **not** a login
account. On the sign-up page, create your own account to get started.

## Verification

Reusable checks live outside the repo (in the temp workspace) and target a
running server:

- `auth-sanity.cjs` — bcrypt/JWT unit sanity
- `db-inspect.cjs` — schema + ownership counts
- `auth-api-test.mjs` — auth endpoint behaviour (201/409/401/logout/me)
- `ownership-test.mjs` — user isolation (cross-user 404s, list scoping)
- `client/scripts/nav-test.mjs` / `nav-test2.mjs` — jsdom navigation suites
  (run inside `client/` after `npm run build`)