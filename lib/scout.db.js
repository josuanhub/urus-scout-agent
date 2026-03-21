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

async function insertScoutRun({ mode, inputText, output }) {
  const db = getPool();

  await db.query(
    `
    INSERT INTO scout_runs (mode, input_text, output)
    VALUES ($1, $2, $3)
    `,
    [mode, inputText, output]
  );
}

async function upsertScoutMemory({ memoryKey, kind, payload }) {
  const db = getPool();

  await db.query(
    `
    INSERT INTO scout_memory (memory_key, kind, payload)
    VALUES ($1, $2, $3)
    ON CONFLICT (memory_key)
    DO UPDATE SET
      kind = EXCLUDED.kind,
      payload = EXCLUDED.payload,
      updated_at = now()
    `,
    [memoryKey, kind, payload]
  );
}

async function getRecentScoutRuns(limit = 10) {
  const db = getPool();
  const r = await db.query(
    `
    SELECT id, mode, input_text, output, created_at
    FROM scout_runs
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [limit]
  );
  return r.rows;
}

async function getRecentScoutMemory(limit = 20) {
  const db = getPool();
  const r = await db.query(
    `
    SELECT id, memory_key, kind, payload, created_at, updated_at
    FROM scout_memory
    ORDER BY updated_at DESC
    LIMIT $1
    `,
    [limit]
  );
  return r.rows;
}

module.exports = {
  getPool,
  ensureScoutSchema,
  insertScoutRun,
  upsertScoutMemory,
  getRecentScoutRuns,
  getRecentScoutMemory
};
