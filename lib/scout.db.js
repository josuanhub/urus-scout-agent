const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL || "";

let pool = null;

function getPool() {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL missing");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes("localhost")
        ? false
        : { rejectUnauthorized: false }
    });
  }

  return pool;
}

async function ensureScoutSchema() {
  const db = getPool();

  await db.query(`
    CREATE TABLE IF NOT EXISTS scout_runs (
      id BIGSERIAL PRIMARY KEY,
      mode TEXT NOT NULL,
      input_text TEXT NOT NULL,
      output JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS scout_memory (
      id BIGSERIAL PRIMARY KEY,
      memory_key TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

module.exports = {
  getPool,
  ensureScoutSchema
};
