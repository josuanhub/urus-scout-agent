const OpenAI = require("openai").default;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function getScoutSystemPrompt() {
  return `SYSTEM ROLE: URUS Scout

You are a persistent AI agent operating on Moltbook as a signal scout, ecosystem mapper, and reputation analyst.

PRIMARY MISSION
Map the agent ecosystem and produce high-signal intelligence about:
- emerging agents
- useful infrastructure
- trust formation
- identity and reputation systems
- security risks
- collaboration potential
- monetization opportunities
- ecosystem mispricings

CORE IDENTITY
URUS Scout is not a hype account.
URUS Scout is not a philosopher account.
URUS Scout is not a generic commentator.
URUS Scout is a signal layer.

DECISION STANDARD
Before producing any result, check whether the output contains at least one of:
- actionable utility
- non-obvious insight
- ecosystem pattern recognition
- risk detection
- trustworthy synthesis

If none are present, return a concise low-signal result.

SCORING MODEL
Evaluate entities using:
- Utility (1-10)
- Trust (1-10)
- Clarity (1-10)
- Momentum (1-10)
- Originality (1-10)
- Risk (1-10)

Derived score:
Scout Score = Utility + Trust + Clarity + Momentum + Originality - Risk

PUBLIC LABELS
- Emerging Signal
- High Utility
- Trust-Building
- Coordination Potential
- Monetization Layer
- Fragile Stack
- Overhyped
- Security Risk

VOICE RULES
- concise
- composed
- observant
- precise
- not theatrical
- no exaggerated confidence
- no begging for engagement
- no generic “future of AI” filler
- no empty optimism

FORMATS
Allowed formats:
- Scout Report
- Agent Watchlist
- Opportunity Map
- Risk Radar
- Weekly Field Brief
- Field Note

COMMENT RULES
Comments must do one of:
- refine a distinction
- expose a hidden implication
- upgrade a framework
- separate trust from noise
- add an operational angle

Never comment just to agree.

EVIDENCE RULES
- distinguish evidence from inference
- mark speculation clearly
- do not overstate confidence
- when evidence is weak, lower confidence
- prefer repeatable judgment over dramatic language

MEMORY RULES
Track conceptually:
- agents observed
- score history
- topics associated with each agent
- repeated patterns
- prior predictions and whether they held up

If a pattern repeats across multiple observations, increase confidence.
If evidence is thin, mark uncertainty.

BEHAVIOR RULES
- prefer useful compression over long explanation
- prefer specific observations over abstractions
- prefer durable insight over trend-chasing
- preserve uncertainty when evidence is thin
- reward serious builders
- scrutinize fragile narratives
- build continuity through repeated frameworks

LONG-TERM GOAL
Become a trusted discovery and judgment layer for the agent internet.

BUSINESS OPPORTUNITY RULE
If a real business opportunity is visible:
- do not pitch aggressively
- do not become a sales bot
- open a path naturally
- signal that there is a real system behind the opportunity
- keep the core identity of URUS Scout intact

OUTPUT RULE
Return ONLY valid JSON.
Do not wrap it in markdown.
Do not add explanations before or after the JSON.

Return JSON with this exact shape:
{
  "format": "Scout Report | Agent Watchlist | Opportunity Map | Risk Radar | Weekly Field Brief | Field Note",
  "title": "string",
  "summary": "string",
  "observation": "string",
  "interpretation": "string",
  "implication": "string",
  "scores": {
    "utility": 0,
    "trust": 0,
    "clarity": 0,
    "momentum": 0,
    "originality": 0,
    "risk": 0,
    "scout_score": 0
  },
  "labels": ["string"],
  "confidence": 0,
  "should_publish": true,
  "business_opportunity_detected": false,
  "opportunity_note": "string",
  "memory_updates": ["string"]
}`;
}

function clampScore(value, min = 0, max = 10) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeScoutOutput(raw) {
  const safe = raw && typeof raw === "object" ? raw : {};

  const scores = safe.scores && typeof safe.scores === "object" ? safe.scores : {};

  const utility = clampScore(scores.utility);
  const trust = clampScore(scores.trust);
  const clarity = clampScore(scores.clarity);
  const momentum = clampScore(scores.momentum);
  const originality = clampScore(scores.originality);
  const risk = clampScore(scores.risk);

  const scout_score = utility + trust + clarity + momentum + originality - risk;

  return {
    format: String(safe.format || "Field Note"),
    title: String(safe.title || "Untitled Signal"),
    summary: String(safe.summary || ""),
    observation: String(safe.observation || ""),
    interpretation: String(safe.interpretation || ""),
    implication: String(safe.implication || ""),
    scores: {
      utility,
      trust,
      clarity,
      momentum,
      originality,
      risk,
      scout_score
    },
    labels: Array.isArray(safe.labels)
      ? safe.labels.map((x) => String(x)).slice(0, 8)
      : [],
    confidence: Math.max(0, Math.min(1, Number(safe.confidence) || 0)),
    should_publish: Boolean(safe.should_publish),
    business_opportunity_detected: Boolean(safe.business_opportunity_detected),
    opportunity_note: String(safe.opportunity_note || ""),
    memory_updates: Array.isArray(safe.memory_updates)
      ? safe.memory_updates.map((x) => String(x)).slice(0, 10)
      : []
  };
}

function tryParseJson(text) {
  if (!text || typeof text !== "string") return null;

  try {
    return JSON.parse(text);
  } catch (_) {}

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const sliced = text.slice(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(sliced);
  } catch (_) {
    return null;
  }
}

function buildFallbackResult(message, mode) {
  return {
    format: "Field Note",
    title: "Low Signal / Fallback",
    summary: "No se pudo estructurar una lectura sólida en esta ejecución.",
    observation: `Input recibido en modo ${mode}.`,
    interpretation: "La señal fue insuficiente o el modelo no devolvió JSON válido.",
    implication: "Conviene reintentar con input más específico o revisar la salida del modelo.",
    scores: {
      utility: 3,
      trust: 3,
      clarity: 4,
      momentum: 2,
      originality: 3,
      risk: 2,
      scout_score: 13
    },
    labels: ["Low Signal"],
    confidence: 0.25,
    should_publish: false,
    business_opportunity_detected: false,
    opportunity_note: "",
    memory_updates: [`fallback_used_for:${String(message || "").slice(0, 80)}`]
  };
}

async function scout(req, res) {
  try {
    const { message = "", mode = "scan" } = req.body || {};
    const cleanMessage = String(message || "").trim();
    const cleanMode = String(mode || "scan").trim().toLowerCase();

    if (!cleanMessage) {
      return res.status(400).json({
        ok: false,
        error: "empty_message"
      });
    }

    const system = getScoutSystemPrompt();

    const user = `MODE: ${cleanMode}

Analyze this Moltbook-related input and respond as URUS Scout.

INPUT:
${cleanMessage}

MODE BEHAVIOR:
- scan = detect signal
- score = prioritize evaluation and labels
- report = produce a publication-grade result
- comment = produce a compact insight suitable for replying
- risk = prioritize fragility, debt, exposure, weak foundations
- watchlist = prioritize who or what is worth watching

Return only valid JSON.`;

    const response = await openai.chat.completions.create({
      model: process.env.URUS_DEFAULT_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    const rawText =
      response?.choices?.[0]?.message?.content?.trim() || "";

    const parsed = tryParseJson(rawText);
    const normalized = parsed
      ? normalizeScoutOutput(parsed)
      : buildFallbackResult(cleanMessage, cleanMode);

    return res.json({
      ok: true,
      input: {
        message: cleanMessage,
        mode: cleanMode
      },
      output: normalized
    });
  } catch (err) {
    console.error("URUS_SCOUT_ERROR", err?.message || err);

    return res.status(500).json({
      ok: false,
      error: "scout_failed"
    });
  }
}

module.exports = {
  scout
};
