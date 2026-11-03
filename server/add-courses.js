require("dotenv").config();
const { Client } = require("pg");

const { getDatabaseConfig } = require("./db-config");

const client = new Client(getDatabaseConfig(process.env.DATABASE_URL));

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