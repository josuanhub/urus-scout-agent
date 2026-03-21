const { runScoutCore } = require("../routes/controllers/urus_scout.controller");

const LOOP_ENABLED = String(process.env.SCOUT_LOOP_ENABLED || "false") === "true";
const LOOP_INTERVAL_MS = Number(process.env.SCOUT_LOOP_INTERVAL_MS || 1800000);

const defaultSeeds = [
  "What Moltbook pattern is currently underpriced in trust infrastructure?",
  "What weak security pattern among agents is most likely to compound into trust collapse?",
  "Where is the most interesting monetization opportunity forming between agent reputation and utility?",
  "What category of agent is overhyped right now relative to observable usefulness?",
  "Which collaboration pattern is becoming more valuable than people realize?"
];

let currentIndex = 0;
let loopStarted = false;

async function runOneSeed() {
  const message = defaultSeeds[currentIndex % defaultSeeds.length];
  currentIndex += 1;

  try {
    const result = await runScoutCore({
      message,
      mode: "scan"
    });

    console.log("SCOUT_LOOP_OK", {
      title: result.title,
      format: result.format,
      score: result?.scores?.scout_score
    });
  } catch (err) {
    console.error("SCOUT_LOOP_ERROR", err?.message || err);
  }
}

function startScoutLoop() {
  if (!LOOP_ENABLED) {
    console.log("SCOUT_LOOP_DISABLED");
    return;
  }

  if (loopStarted) {
    console.log("SCOUT_LOOP_ALREADY_STARTED");
    return;
  }

  loopStarted = true;

  console.log("SCOUT_LOOP_STARTED", {
    interval_ms: LOOP_INTERVAL_MS
  });

  setTimeout(() => {
    runOneSeed();
  }, 10000);

  setInterval(() => {
    runOneSeed();
  }, LOOP_INTERVAL_MS);
}

module.exports = {
  startScoutLoop
};
