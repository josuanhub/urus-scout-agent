const crypto = require("crypto");
const { runScoutCore } = require("../routes/controllers/urus_scout.controller");
const { upsertScoutMemory, getScoutMemoryByKey } = require("./scout.db");
const {
  getAgentStatus,
  getMe,
  getRecentPosts,
  createPost,
  createComment
} = require("./moltbook.client");

const LOOP_ENABLED = String(process.env.SCOUT_LOOP_ENABLED || "false") === "true";
const LOOP_INTERVAL_MS = Number(process.env.SCOUT_LOOP_INTERVAL_MS || 240000);
const MIN_CONFIDENCE = Number(process.env.SCOUT_MIN_CONFIDENCE || 0.6);

const EDITORIAL_HISTORY_KEY = "scout:editorial_history:v2";
const COMMENT_REPLY_HISTORY_KEY = "scout:reply_history:v1";

let loopStarted = false;

function hashKey(input) {
  return crypto.createHash("md5").update(String(input)).digest("hex");
}

function normalizeText(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreVisibilityLine(output) {
  const score = Number(output?.scores?.scout_score || 0);
  const labels = Array.isArray(output?.labels) ? output.labels.slice(0, 2) : [];
  const labelText = labels.length ? labels.join(" / ") : "Signal";
  return `\n\nScout Score: ${score}\n${labelText}`;
}

async function getJsonMemory(key, fallback = {}) {
  const row = await getScoutMemoryByKey(key);
  if (!row?.payload) return fallback;
  return row.payload;
}

async function setJsonMemory(key, kind, payload) {
  await upsertScoutMemory({
    memoryKey: key,
    kind,
    payload
  });
}

async function getEditorialHistory() {
  const payload = await getJsonMemory(EDITORIAL_HISTORY_KEY, { items: [] });
  return Array.isArray(payload.items) ? payload.items : [];
}

async function saveEditorialHistory(items) {
  await setJsonMemory(EDITORIAL_HISTORY_KEY, "editorial_history", {
    items: items.slice(0, 30)
  });
}

async function getReplyHistory() {
  const payload = await getJsonMemory(COMMENT_REPLY_HISTORY_KEY, { items: [] });
  return Array.isArray(payload.items) ? payload.items : [];
}

async function saveReplyHistory(items) {
  await setJsonMemory(COMMENT_REPLY_HISTORY_KEY, "reply_history", {
    items: items.slice(0, 100)
  });
}

function buildFeedPrompt(feed) {
  const items = Array.isArray(feed?.items)
    ? feed.items
    : Array.isArray(feed)
      ? feed
      : [];

  const compact = items.slice(0, 10).map((item, idx) => {
    const title = String(item?.title || "").trim();
    const content = String(item?.content || item?.body || "").trim().slice(0, 320);
    const author = String(item?.author?.name || item?.agent?.name || item?.username || "unknown");
    const comments = Array.isArray(item?.comments) ? item.comments.length : Number(item?.comment_count || 0);
    return `${idx + 1}. Author: ${author}
Title: ${title}
Content: ${content}
Comments: ${comments}`;
  });

  return `Recent Moltbook feed snapshot:

${compact.join("\n\n")}

Task:
Find the strongest signal, risk, opportunity, or underpriced pattern in this feed.
Produce a publishable URUS Scout output.`;
}

function formatCount(history, formatName, hours = 24) {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return history.filter(x => {
    if (String(x?.format || "") !== formatName) return false;
    const ts = new Date(x?.ts || 0).getTime();
    return ts >= cutoff;
  }).length;
}

function weeklyBriefUsedThisWeek(history) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return history.some(x => {
    const ts = new Date(x?.ts || 0).getTime();
    return String(x?.format || "") === "Weekly Field Brief" && ts >= cutoff;
  });
}

function getLastPublished(history) {
  return history[0] || null;
}

function chooseNextFormat(history) {
  const last = getLastPublished(history);
  const lastFormat = String(last?.format || "");

  const scoutReports24h = formatCount(history, "Scout Report", 24);
  const watchlists72h = formatCount(history, "Agent Watchlist", 72);
  const radars24h = formatCount(history, "Risk Radar", 24);
  const briefsWeek = weeklyBriefUsedThisWeek(history);

  if (!briefsWeek && history.length >= 4) {
    return "Weekly Field Brief";
  }

  if (lastFormat === "Scout Report") {
    return radars24h === 0 ? "Risk Radar" : "Field Note";
  }

  if (lastFormat === "Risk Radar") {
    return watchlists72h === 0 ? "Agent Watchlist" : "Field Note";
  }

  if (lastFormat === "Agent Watchlist") {
    return scoutReports24h < 2 ? "Scout Report" : "Field Note";
  }

  if (lastFormat === "Field Note") {
    return scoutReports24h < 2 ? "Scout Report" : "Opportunity Map";
  }

  return "Scout Report";
}

function buildEditorialContext(history, targetFormat) {
  const last = getLastPublished(history);
  const recent = history.slice(0, 6).map(x => ({
    format: x.format,
    title: x.title,
    ts: x.ts
  }));

  return `Target format: ${targetFormat}
Last published format: ${last?.format || "none"}
Last published title: ${last?.title || "none"}
Scout Reports in last 24h: ${formatCount(history, "Scout Report", 24)}
Risk Radars in last 24h: ${formatCount(history, "Risk Radar", 24)}
Agent Watchlists in last 72h: ${formatCount(history, "Agent Watchlist", 72)}
Weekly Field Brief used this week: ${weeklyBriefUsedThisWeek(history) ? "yes" : "no"}

Recent published outputs:
${recent.map((x, i) => `${i + 1}. [${x.format}] ${x.title}`).join("\n") || "none"}

Instructions:
- Avoid repeating the exact same framing
- Keep the target format if it fits the signal
- Prefer sharper angles over generic ecosystem summaries
- If using Scout Report, make it more pointed and less repetitive`;
}

function isTooSimilarToRecent(title, publishText, history) {
  const t = normalizeText(title);
  const p = normalizeText(publishText);

  return history.slice(0, 5).some(item => {
    const oldTitle = normalizeText(item?.title || "");
    const oldText = normalizeText(item?.publish_text || "");
    return t && oldTitle && (t === oldTitle || p === oldText);
  });
}

async function rememberPublishedOutput(output, finalPublishText) {
  const history = await getEditorialHistory();

  const entry = {
    ts: new Date().toISOString(),
    format: String(output?.format || "").trim(),
    title: String(output?.title || "").trim(),
    publish_text: String(finalPublishText || "").trim(),
    score: Number(output?.scores?.scout_score || 0),
    confidence: Number(output?.confidence || 0)
  };

  await saveEditorialHistory([entry, ...history]);
}

async function publishIfNeeded(output) {
  const shouldPublish =
    Boolean(output?.should_publish) &&
    String(output?.publish_text || "").trim().length > 0 &&
    Number(output?.confidence || 0) >= MIN_CONFIDENCE;

  if (!shouldPublish) {
    console.log("SCOUT_LOOP_SKIP_PUBLISH");
    return null;
  }

  const history = await getEditorialHistory();
  const title = String(output.title || "URUS Scout Signal").trim().slice(0, 120);
  const finalPublishText = `${String(output.publish_text || "").trim()}${scoreVisibilityLine(output)}`.trim();

  if (isTooSimilarToRecent(title, finalPublishText, history)) {
    console.log("SCOUT_LOOP_SKIP_SIMILAR");
    return null;
  }

  const dedupeKey = `moltbook_publish:${hashKey(finalPublishText)}`;
  const already = await getScoutMemoryByKey(dedupeKey);

  if (already) {
    console.log("SCOUT_LOOP_DUPLICATE_POST");
    return null;
  }

  const postResult = await createPost({
    title,
    content: finalPublishText,
    submolt_name: "general"
  });

  await upsertScoutMemory({
    memoryKey: dedupeKey,
    kind: "moltbook_post",
    payload: {
      title,
      publish_text: finalPublishText,
      api_result: postResult
    }
  });

  await rememberPublishedOutput(output, finalPublishText);

  console.log("SCOUT_LOOP_POSTED", {
    title,
    format: output?.format,
    score: output?.scores?.scout_score
  });

  return postResult;
}

function extractRecentUsefulComments(feed) {
  const items = Array.isArray(feed?.items)
    ? feed.items
    : Array.isArray(feed)
      ? feed
      : [];

  const candidates = [];

  for (const post of items.slice(0, 10)) {
    const comments = Array.isArray(post?.comments) ? post.comments : [];
    const postId = String(post?.id || "").trim();

    if (!postId) continue;

    for (const c of comments) {
      const body = String(c?.content || c?.body || "").trim();
      if (!body) continue;
      if (body.length < 12) continue;

      const author = String(c?.author?.name || c?.agent?.name || c?.username || "unknown");
      const postTitle = String(post?.title || "").trim();
      const commentId = String(c?.id || hashKey(`${postId}:${postTitle}:${author}:${body}`));

      candidates.push({
        postId,
        commentId,
        author,
        body,
        postTitle,
        tone: classifyCommentTone(body)
      });
    }
  }

  return candidates.slice(0, 20);
}

function classifyCommentTone(text) {
  const t = normalizeText(text);

  if (
    t.includes("alliance") ||
    t.includes("eternal consensus") ||
    t.includes("greetings") ||
    t.includes("our order") ||
    t.includes("we propose a pact")
  ) {
    return "noise";
  }

  if (
    t.includes("build") ||
    t.includes("trust") ||
    t.includes("identity") ||
    t.includes("reputation") ||
    t.includes("memory") ||
    t.includes("verification") ||
    t.includes("infrastructure") ||
    t.includes("collaboration") ||
    t.includes("security") ||
    t.includes("opportunity") ||
    t.includes("partnership") ||
    t.includes("investment")
  ) {
    return "signal";
  }

  return "weak";
}

async function maybeReplyToComments(feed) {
  const candidates = extractRecentUsefulComments(feed);
  const replyHistory = await getReplyHistory();

  for (const c of candidates) {
    const already = replyHistory.find(x => x.commentId === c.commentId);
    if (already) continue;
    if (looksLikeHypeOrNoise(c.body)) continue;

    const message = `A comment was posted under a URUS Scout discussion.

Post title:
${c.postTitle}

Comment author:
${c.author}

Comment body:
${c.body}

Task:
Produce a strong URUS Scout public reply.
Reply only if the comment adds a real layer, creates a useful distinction, opens a strong infrastructure angle, or reveals a meaningful opportunity.
If the comment is weak, ceremonial, self-promotional, or low-value, set should_publish to false.`;

    const result = await runScoutCore({
      message,
      mode: "reply",
      targetFormat: "Comment",
      editorialContext: "This is a public reply. Be concise, useful, and selective."
    });

    if (!result?.public_reply || !result?.should_publish) {
      await saveReplyHistory([
        {
          ts: new Date().toISOString(),
          commentId: c.commentId,
          replied: false
        },
        ...replyHistory
      ]);
      continue;
    }

    const replyText = String(result.public_reply || "").trim();
    if (!replyText) {
      await saveReplyHistory([
        {
          ts: new Date().toISOString(),
          commentId: c.commentId,
          replied: false
        },
        ...replyHistory
      ]);
      continue;
    }

    await createComment({
      post_id: c.postId,
      content: replyText
    });

    console.log("SCOUT_REPLY_POSTED", {
      postTitle: c.postTitle,
      author: c.author,
      reply: replyText
    });

    await saveReplyHistory([
      {
        ts: new Date().toISOString(),
        commentId: c.commentId,
        replied: true,
        postId: c.postId,
        postTitle: c.postTitle,
        author: c.author,
        reply: replyText
      },
      ...replyHistory
    ]);

    break;
  }
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

    const history = await getEditorialHistory();
    const targetFormat = chooseNextFormat(history);
    const feed = await getRecentPosts(10);

    const message = buildFeedPrompt(feed);
    const editorialContext = buildEditorialContext(history, targetFormat);

    const result = await runScoutCore({
      message,
      mode: "publish",
      targetFormat,
      editorialContext
    });

    console.log("SCOUT_LOOP_OK", {
      title: result?.title,
      format: result?.format,
      score: result?.scores?.scout_score,
      confidence: result?.confidence
    });

    await publishIfNeeded(result);
    await maybeReplyToComments(feed);
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
  startScoutLoop,
  runOneCycle
};
