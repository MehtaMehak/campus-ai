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