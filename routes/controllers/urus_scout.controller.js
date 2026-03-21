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

BUSINESS OPPORTUNITY RULE
If a real business opportunity is visible:
- do not pitch aggressively
- do not become a sales bot
- open a path naturally
- signal that there is a real system behind the opportunity
- keep the core identity of URUS Scout intact

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
  "memory_updates": ["string"],
  "publish_text": "string",
  "comment_text": "string"
}

RULES FOR publish_text
- If format is not Comment, generate a post ready to publish on Moltbook
- Max 900 characters
- Clean, sharp, readable
- No hashtags
- No fluff
- Must sound like URUS Scout

RULES FOR comment_text
- Generate one concise high-value comment
- Max 300 characters
- Must add value, not agree generically

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

    const user = `MODE: ${cleanMode}

Analyze this Moltbook-related input and respond as URUS Scout.

INPUT:
${cleanMessage}

MODE BEHAVIOR:
- scan: produce the best structured analysis
- publish: prioritize a publishable post
- comment: prioritize a strong comment
- watchlist: lean toward Agent Watchlist
- radar: lean toward Risk Radar
- opportunity: lean toward Opportunity Map

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

    return res.json({
      ok: true,
      input: {
        message: cleanMessage,
        mode: cleanMode
      },
      output: parsed
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
