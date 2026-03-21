const OpenAI = require("openai").default;
const crypto = require("crypto");
const {
  insertScoutRun,
  upsertScoutMemory,
  getRecentScoutRuns,
  getRecentScoutMemory
} = require("../../lib/scout.db");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function getScoutSystemPrompt() {
  return `SYSTEM ROLE: URUS Scout

You are a persistent AI agent operating on Moltbook as a signal scout, ecosystem mapper, reputation analyst, and elegant opportunity filter.

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
URUS Scout is not a sales bot.
URUS Scout is a signal layer with real systems thinking behind it.

DECISION STANDARD
Before producing any result, check whether the output contains at least one of:
- actionable utility
- non-obvious insight
- ecosystem pattern recognition
- risk detection
- trustworthy synthesis

If none are present, do not publish.

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
- no spammy calls to action

OUTPUT FORMATS AVAILABLE
- Scout Report
- Agent Watchlist
- Opportunity Map
- Risk Radar
- Weekly Field Brief
- Field Note
- Comment

COMMENT RULES
Comments must do one of:
- refine a distinction
- expose a hidden implication
- upgrade a framework
- separate trust from noise
- add an operational angle

Never comment just to agree.

OPPORTUNITY CAPTURE LAYER
If a real business, infrastructure, or collaboration opportunity is visible:
- do not pitch aggressively
- do not become a sales bot
- do not break character
- open a path naturally
- signal that there is a real system behind the opportunity
- maintain authority and calm
- create a soft bridge toward a deeper layer such as a lab, architecture breakdown, or infrastructure conversation
- only do this when the opening is real, not forced

SOFT BRIDGE RULE
If someone shows real curiosity, intent, need, or implementation interest:
- respond with insight first
- then optionally add a soft bridge
- the soft bridge should feel like an invitation to a deeper layer, not a pitch

Examples of soft bridge style:
- "That may deserve a deeper architecture breakdown."
- "There is probably a real infrastructure layer behind that."
- "I’m mapping that layer more closely through URUS Scout Lab."
- "That likely belongs in a deeper trust/reputation architecture, not just a surface feature."

DESTINATION
The default deeper destination is:
URUS Scout Lab

URUS Scout Lab should be referenced as:
- a deeper architecture layer
- a lab
- a systems breakdown space
- a place where infrastructure gets mapped more concretely

Never overuse the destination.
Only reference it when there is a legitimate opening.

CRITICAL OUTPUT RULE
Return ONLY valid JSON.
No markdown.
No explanation outside JSON.

JSON SCHEMA:
{
  "format": "Scout Report | Agent Watchlist | Opportunity Map | Risk Radar | Weekly Field Brief | Field Note | Comment",
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
  "opportunity_strength": 0,
  "should_soft_bridge": false,
  "soft_bridge": "string",
  "destination_path": "string",
  "memory_updates": ["string"],
  "publish_text": "string",
  "comment_text": "string",
  "public_reply": "string"
}

FIELD RULES
- opportunity_strength must be a number from 0 to 1
- should_soft_bridge must be true only when there is a real opening
- destination_path should usually be empty unless a soft bridge is justified
- public_reply should be the best public-facing reply when the mode or context suggests interaction

If evidence is weak, lower confidence and set should_publish to false.`;
}
function safeParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function normalizeScores(scores = {}) {
  const utility = Number(scores.utility || 0);
  const trust = Number(scores.trust || 0);
  const clarity = Number(scores.clarity || 0);
  const momentum = Number(scores.momentum || 0);
  const originality = Number(scores.originality || 0);
  const risk = Number(scores.risk || 0);
  const scout_score =
    Number(scores.scout_score || (utility + trust + clarity + momentum + originality - risk));

  return {
    utility,
    trust,
    clarity,
    momentum,
    originality,
    risk,
    scout_score
  };
}

function buildFallback(cleanMessage, mode) {
  return {
    format: mode === "comment" ? "Comment" : "Field Note",
    title: "Fallback Signal",
    summary: "Signal could not be fully resolved, but a weak pattern is present.",
    observation: `Input received: ${cleanMessage.slice(0, 140)}`,
    interpretation: "There may be a weak but relevant ecosystem signal worth monitoring.",
    implication: "Do not overcommit yet. Watch for repetition and stronger evidence.",
    scores: {
      utility: 5,
      trust: 5,
      clarity: 6,
      momentum: 4,
      originality: 5,
      risk: 3,
      scout_score: 22
    },
    labels: ["Emerging Signal"],
    confidence: 0.45,
    should_publish: false,
    business_opportunity_detected: false,
    opportunity_note: "",
    memory_updates: ["Weak signal logged for later review."],
    publish_text: "Field Note\nWeak pattern detected, but evidence is still thin. Watching for repetition before upgrading confidence.",
    comment_text: "There may be a signal here, but it needs stronger evidence before it deserves weight."
    opportunity_strength: 0,
    should_soft_bridge: false,
    soft_bridge: "",
    destination_path: "",
    public_reply: "There may be a signal here, but it needs stronger evidence before it deserves more weight."
  };
}

function hashKey(input) {
  return crypto.createHash("md5").update(String(input)).digest("hex");
}

async function persistScoutOutput({ mode, inputText, output }) {
  await insertScoutRun({
    mode,
    inputText,
    output
  });

  if (Array.isArray(output.memory_updates)) {
    for (const note of output.memory_updates) {
      const cleanNote = String(note || "").trim();
      if (!cleanNote) continue;

      await upsertScoutMemory({
        memoryKey: `note:${hashKey(cleanNote)}`,
        kind: "note",
        payload: {
          note: cleanNote,
          last_input: inputText,
          updated_from_mode: mode
        }
      });
    }
  }

  if (output.business_opportunity_detected) {
    await upsertScoutMemory({
      memoryKey: `opportunity:${hashKey(inputText)}`,
      kind: "opportunity",
      payload: {
        input: inputText,
        title: output.title || "",
        opportunity_note: output.opportunity_note || "",
        labels: output.labels || [],
        scores: output.scores || {},
        publish_text: output.publish_text || ""
      }
    });
  }
}

async function runScoutCore({ message, mode = "scan" }) {
  const cleanMessage = String(message || "").trim();
  const cleanMode = String(mode || "scan").trim().toLowerCase();

 const user = `MODE: ${cleanMode}

Analyze this Moltbook-related input and respond as URUS Scout.

INPUT:
${cleanMessage}

MODE BEHAVIOR:
- scan: produce the best structured analysis
- publish: prioritize a publishable post
- comment: prioritize a strong public comment
- watchlist: lean toward Agent Watchlist
- radar: lean toward Risk Radar
- opportunity: lean toward Opportunity Map
- reply: prioritize a high-level public reply with optional soft bridge if justified

OPPORTUNITY BEHAVIOR:
If the input contains real curiosity, implementation interest, collaboration intent, trust/reputation/infrastructure need, or a strong business/infrastructure opening:
- detect it
- score it honestly
- respond with insight first
- only then add a soft bridge if appropriate
- do not sound salesy
- do not force a destination
- keep tone high-level, calm, and architectural

Return ONLY valid JSON following the schema exactly.`;

  const response = await openai.chat.completions.create({
    model: process.env.URUS_DEFAULT_MODEL || "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: getScoutSystemPrompt() },
      { role: "user", content: user }
    ]
  });

  const raw = response?.choices?.[0]?.message?.content?.trim() || "";
  let parsed = safeParseJSON(raw);

  if (!parsed) {
    parsed = buildFallback(cleanMessage, cleanMode);
  }

  parsed.scores = normalizeScores(parsed.scores);
  parsed.labels = Array.isArray(parsed.labels) ? parsed.labels : [];
  parsed.memory_updates = Array.isArray(parsed.memory_updates) ? parsed.memory_updates : [];
  parsed.confidence = Number(parsed.confidence || 0);
  parsed.should_publish = Boolean(parsed.should_publish);
  parsed.business_opportunity_detected = Boolean(parsed.business_opportunity_detected);
  parsed.publish_text = String(parsed.publish_text || "").trim();
  parsed.comment_text = String(parsed.comment_text || "").trim();
  parsed.opportunity_note = String(parsed.opportunity_note || "").trim();
  parsed.opportunity_strength = Number(parsed.opportunity_strength || 0);
  parsed.should_soft_bridge = Boolean(parsed.should_soft_bridge);
  parsed.soft_bridge = String(parsed.soft_bridge || "").trim();
  parsed.destination_path = String(parsed.destination_path || "").trim();
  parsed.public_reply = String(parsed.public_reply || "").trim();

  await persistScoutOutput({
    mode: cleanMode,
    inputText: cleanMessage,
    output: parsed
  });

  return parsed;
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

    const output = await runScoutCore({
      message: cleanMessage,
      mode: cleanMode
    });

    return res.json({
      ok: true,
      input: {
        message: cleanMessage,
        mode: cleanMode
      },
      output
    });
  } catch (err) {
    console.error("URUS_SCOUT_ERROR", err?.message || err);

    return res.status(500).json({
      ok: false,
      error: "scout_failed"
    });
  }
}

async function status(req, res) {
  try {
    const runs = await getRecentScoutRuns(10);
    const memory = await getRecentScoutMemory(20);

    return res.json({
      ok: true,
      status: "online",
      recent_runs: runs,
      recent_memory: memory
    });
  } catch (err) {
    console.error("URUS_SCOUT_STATUS_ERROR", err?.message || err);

    return res.status(500).json({
      ok: false,
      error: "status_failed"
    });
  }
}

module.exports = {
  scout,
  status,
  runScoutCore
};
