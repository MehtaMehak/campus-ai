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

async function addCourses() {
  try {
    await client.connect();

    await client.query(`
      INSERT INTO courses (name, code)
      VALUES
        ('Bachelor of Arts', 'BA'),
        ('Bachelor of Commerce', 'BCom'),
        ('Bachelor of Science', 'BSc'),
        ('Computer Applications', 'BCA')
      ON CONFLICT (code) DO NOTHING;
    `);

    console.log("✅ Courses added successfully!");
  } catch (error) {
    console.log("❌ Failed to add courses");
    console.log(error.message);
  } finally {
    await client.end();
  }
}

addCourses();