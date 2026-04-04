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

  // Índice para acelerar queries por kind — crítico cuando la tabla crece
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_scout_memory_kind
    ON scout_memory (kind);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_scout_memory_kind_updated
    ON scout_memory (kind, updated_at DESC);
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

async function getScoutMemoryByKey(memoryKey) {
  const db = getPool();

  const r = await db.query(
    `
    SELECT id, memory_key, kind, payload, created_at, updated_at
    FROM scout_memory
    WHERE memory_key = $1
    LIMIT 1
    `,
    [memoryKey]
  );

  return r.rows[0] || null;
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

// ─── ORIGINAL — mantener para compatibilidad ─────────────────────────────────
// Trae las últimas N filas de cualquier kind.
// Útil para el status endpoint y debugging general.
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

// ─── NUEVO — filtra directamente por kind en SQL ──────────────────────────────
// Evita el problema de que agent_scores queden sepultados bajo otras entradas.
// Úsalo en el leaderboard y topAgents en lugar de getRecentScoutMemory.
async function getMemoryByKind(kind, limit = 1000) {
  const db = getPool();
  const r = await db.query(
    `
    SELECT id, memory_key, kind, payload, created_at, updated_at
    FROM scout_memory
    WHERE kind = $1
    ORDER BY updated_at DESC
    LIMIT $2
    `,
    [kind, limit]
  );
  return r.rows;
}

// ─── NUEVO — agregación de agentes directo en SQL ────────────────────────────
// Calcula avg_score, interactions y dominance_score en la DB.
// Mucho más eficiente que traer todas las filas y procesarlas en JS.
// Devuelve todos los agentes únicos con sus métricas agregadas.
async function getAgentScores() {
  const db = getPool();
  const r = await db.query(
    `
    SELECT
      payload->>'author'                                        AS agent,
      COUNT(*)                                                  AS interactions,
      AVG((payload->'score'->>'scout_score')::float)            AS avg_score,
      LEAST(COUNT(*) / 5.0, 1.0)                               AS consistency,
      AVG((payload->'score'->>'scout_score')::float)
        * (0.7 + LEAST(COUNT(*) / 5.0, 1.0) * 0.3)            AS dominance_score,
      MAX(updated_at)                                           AS last_seen
    FROM scout_memory
    WHERE kind = 'agent_score'
      AND payload->>'author' IS NOT NULL
      AND payload->>'author' != ''
    GROUP BY payload->>'author'
    ORDER BY dominance_score DESC
    `
  );

  return r.rows.map(row => ({
    agent:          String(row.agent),
    interactions:   Number(row.interactions),
    avg_score:      Number(parseFloat(row.avg_score).toFixed(2)),
    dominance_score: Number(parseFloat(row.dominance_score).toFixed(2)),
    consistency:    Number(parseFloat(row.consistency).toFixed(2)),
    last_seen:      row.last_seen
  }));
}

// ─── NUEVO — conteo total de señales por kind ─────────────────────────────────
// Para el status/metrics endpoint — devuelve cuántas entradas hay por tipo.
async function getMemoryStats() {
  const db = getPool();
  const r = await db.query(
    `
    SELECT kind, COUNT(*) as count
    FROM scout_memory
    GROUP BY kind
    ORDER BY count DESC
    `
  );
  return r.rows;
}

module.exports = {
  getPool,
  ensureScoutSchema,
  insertScoutRun,
  upsertScoutMemory,
  getScoutMemoryByKey,
  getRecentScoutRuns,
  getRecentScoutMemory,  // original — no se rompe nada
  getMemoryByKind,       // nuevo — filtra por kind
  getAgentScores,        // nuevo — agrega scores en SQL directo
  getMemoryStats         // nuevo — stats por kind
};
