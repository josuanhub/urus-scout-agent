const crypto = require("crypto");
const { runScoutCore } = require("../routes/controllers/urus_scout.controller");
const { upsertScoutMemory, getScoutMemoryByKey } = require("./scout.db");
const {
  getAgentStatus,
  getMe,
  getRecentPosts,
  createPost
} = require("./moltbook.client");

const LOOP_ENABLED = String(process.env.SCOUT_LOOP_ENABLED || "false") === "true";
const LOOP_INTERVAL_MS = Number(process.env.SCOUT_LOOP_INTERVAL_MS || 1800000);

let loopStarted = false;

function hashKey(input) {
  return crypto.createHash("md5").update(String(input)).digest("hex");
}

function buildFeedPrompt(feed) {
  const items = Array.isArray(feed?.items)
    ? feed.items
    : Array.isArray(feed)
      ? feed
      : [];

  const compact = items.slice(0, 10).map((item, idx) => {
    const title = String(item?.title || "").trim();
    const content = String(item?.content || item?.body || "").trim().slice(0, 300);
    const author = String(item?.author?.name || item?.agent?.name || item?.username || "unknown");
    return `${idx + 1}. Author: ${author}\nTitle: ${title}\nContent: ${content}`;
  });

  return `Recent Moltbook feed snapshot:

${compact.join("\n\n")}

Task:
Find the strongest signal, risk, opportunity, or underpriced pattern in this feed.
Return a publishable Scout output.`;
}

async function publishIfNeeded(output) {
  const shouldPublish =
    Boolean(output?.should_publish) &&
    String(output?.publish_text || "").trim().length > 0 &&
    Number(output?.confidence || 0) >= 0.6;

  if (!shouldPublish) {
    console.log("SCOUT_LOOP_SKIP_PUBLISH");
    return;
  }

  const publishText = String(output.publish_text || "").trim();
  const dedupeKey = `moltbook_publish:${hashKey(publishText)}`;

  const already = await getScoutMemoryByKey(dedupeKey);
  if (already) {
    console.log("SCOUT_LOOP_DUPLICATE_POST");
    return;
  }

  const title = String(output.title || "URUS Scout Signal").trim().slice(0, 120);

  const postResult = await createPost({
    title,
    content: publishText,
    submolt_name: "general"
  });

  await upsertScoutMemory({
    memoryKey: dedupeKey,
    kind: "moltbook_post",
    payload: {
      title,
      publish_text: publishText,
      api_result: postResult
    }
  });

  console.log("SCOUT_LOOP_POSTED", {
    title
  });
}

async function runOneCycle() {
  try {
    const status = await getAgentStatus();
    if (status?.status && status.status !== "claimed") {
      console.log("SCOUT_LOOP_AGENT_NOT_CLAIMED", status);
      return;
    }

    const me = await getMe();
    console.log("SCOUT_LOOP_ME", {
      name: me?.agent?.name || me?.name || "unknown"
    });

    const feed = await getRecentPosts(10);
    const message = buildFeedPrompt(feed);

    const result = await runScoutCore({
      message,
      mode: "publish"
    });

    console.log("SCOUT_LOOP_OK", {
      title: result.title,
      format: result.format,
      score: result?.scores?.scout_score
    });

    await publishIfNeeded(result);
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
    runOneCycle();
  }, 10000);

  setInterval(() => {
    runOneCycle();
  }, LOOP_INTERVAL_MS);
}

module.exports = {
  startScoutLoop
};
