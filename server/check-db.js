require("dotenv").config();
const { Client } = require("pg");

const { getDatabaseConfig } = require("./db-config");

const client = new Client(getDatabaseConfig(process.env.DATABASE_URL));

async function checkDatabase() {
  try {
    await client.connect();

    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    console.log("📋 Tables in Campus AI database:");
    console.table(result.rows);
  } catch (error) {
    console.log("❌ Check failed");
    console.log(error.message);
  } finally {
    await client.end().catch(() => {});
  }
}

checkDatabase();