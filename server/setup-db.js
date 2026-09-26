require("dotenv").config();
const { Client } = require("pg");

const dbUrl = new URL(process.env.DATABASE_URL);

const client = new Client({
  host: "3.141.122.14",
  port: 5432,
  user: decodeURIComponent(dbUrl.username),
  password: decodeURIComponent(dbUrl.password),
  database: dbUrl.pathname.slice(1),
  ssl: {
    rejectUnauthorized: false,
  },
  options: "endpoint=ep-little-dust-b5h9s7m7",
});

async function setupDatabase() {
  try {
    await client.connect();

  await client.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assignments (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  due_date DATE,
  status VARCHAR(20) DEFAULT 'Pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS study_tasks (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  study_date DATE,
  priority VARCHAR(20) DEFAULT 'Medium',
  status VARCHAR(20) DEFAULT 'Pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Resources: URL-based study material links, owned per user and attached to a
-- course (same ownership + cascade conventions as notes / assignments).
CREATE TABLE IF NOT EXISTS resources (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  resource_type VARCHAR(30) NOT NULL,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_resources_user_id ON resources(user_id);
CREATE INDEX IF NOT EXISTS idx_resources_course_id ON resources(course_id);

`);

  await client.query(`
/* ============================================================
   Authentication migration (idempotent + additive only)
   Adds password hashing + per-user ownership of study data.
   Nothing here deletes or drops existing data.
   ============================================================ */

-- 1. users: password hash for login (bcrypt output ~60 chars)
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';

-- 2. ownership columns on user data (nullable for now; the server sets
--    them from the moment accounts exist, and a later backfill + SET NOT
--    NULL step hardens them once every row has an owner)
ALTER TABLE notes ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE study_tasks ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
CREATE INDEX IF NOT EXISTS idx_assignments_user_id ON assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_study_tasks_user_id ON study_tasks(user_id);

-- 3. a placeholder OWNER for rows created before accounts existed, so no
--    existing data becomes orphaned. It is deliberately not a real login
--    account (password_hash is an invalid marker, not a bcrypt hash).
INSERT INTO users (name, email, password_hash)
VALUES ('Legacy data', 'legacy@campus.local', '!')
ON CONFLICT (email) DO NOTHING;

-- 4. attach any pre-existing rows to that placeholder owner
UPDATE notes
SET user_id = (SELECT id FROM users WHERE email = 'legacy@campus.local')
WHERE user_id IS NULL;

UPDATE assignments
SET user_id = (SELECT id FROM users WHERE email = 'legacy@campus.local')
WHERE user_id IS NULL;

UPDATE study_tasks
SET user_id = (SELECT id FROM users WHERE email = 'legacy@campus.local')
WHERE user_id IS NULL;

-- remove the temporary default now that every row has a real value
ALTER TABLE users ALTER COLUMN password_hash DROP DEFAULT;

-- 5. ownership hardening: every row must belong to someone from now on.
--    Runs after the server already scopes every write by user_id, so this
--    is safe against the running application (idempotent).
ALTER TABLE notes ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE assignments ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE study_tasks ALTER COLUMN user_id SET NOT NULL;
`);

    console.log("✅ Users, courses, notes, assignments, study_tasks and resources tables are ready!");
    console.log("✅ Auth migration applied (password_hash + user_id ownership columns)");
  } catch (error) {
    console.log("❌ Database setup failed");
    console.log(error.message);
  } finally {
    await client.end().catch(() => {});
  }
}

setupDatabase();