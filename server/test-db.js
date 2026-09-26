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
    `);

    console.log("✅ Users table created successfully!");
  } catch (error) {
    console.log("❌ Database setup failed");
    console.log(error.message);
  } finally {
    await client.end().catch(() => {});
  }
}

setupDatabase();