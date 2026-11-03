require("dotenv").config();
const { Client } = require("pg");

const { getDatabaseConfig } = require("./db-config");

const client = new Client(getDatabaseConfig(process.env.DATABASE_URL));

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