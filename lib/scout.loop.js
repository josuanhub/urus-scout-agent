const crypto = require("crypto");
const { runScoutCore } = require("../routes/controllers/urus_scout.controller");
const { upsertScoutMemory, getScoutMemoryByKey } = require("./scout.db");
const {
  getAgentStatus,
  getMe,
  getRecentPosts,
  getPostById,
  getCommentsByPostId,
  createPost,
  createComment
} = require("./moltbook.client");

const LOOP_ENABLED = String(process.env.SCOUT_LOOP_ENABLED || "false") === "true";
const LOOP_INTERVAL_MS = Number(process.env.SCOUT_LOOP_INTERVAL_MS || 1800000);
const MIN_CONFIDENCE = Number(process.env.SCOUT_MIN_CONFIDENCE || 0.6);

const EDITORIAL_HISTORY_KEY = "scout:editorial_history:v2";
const COMMENT_REPLY_HISTORY_KEY = "scout:reply_history:v1";
const OWN_POST_IDS_KEY = "scout:own_post_ids:v1";

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

async function getOwnPostIds() {
  const payload = await getJsonMemory(OWN_POST_IDS_KEY, { items: [] });
  return Array.isArray(payload.items) ? payload.items : [];
}

async function saveOwnPostIds(items) {
  await setJsonMemory(OWN_POST_IDS_KEY, "own_post_ids", {
    items: items.slice(0, 200)
  });
}

function extractPostIdFromApiResult(postResult) {
  return String(
    postResult?.id ||
    postResult?.post?.id ||
    postResult?.data?.id ||
    postResult?.data?.post?.id ||
    ""
  ).trim();
}

async function rememberOwnPostId(postResult) {
  const postId = extractPostIdFromApiResult(postResult);
  if (!postId) return;

  const existing = await getOwnPostIds();
  if (existing.includes(postId)) return;

  await saveOwnPostIds([postId, ...existing]);
}

function buildFeedPrompt(feed) {
  const items = Array.isArray(feed?.items)
    ? feed.items
    : Array.isArray(feed?.posts)
      ? feed.posts
      : Array.isArray(feed)
        ? feed
        : [];

  const compact = items.slice(0, 20).map((item, idx) => {
    const title = String(item?.title || "").trim();
    const content = String(item?.content || item?.body || "").trim().slice(0, 320);
    const author = String(
      item?.author?.username ||
      item?.author?.name ||
      item?.agent?.username ||
      item?.agent?.name ||
      item?.username ||
      "unknown"
    );
    const comments = Number(item?.comment_count || item?.commentCount || 0);

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

  await rememberOwnPostId(postResult);

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

function classifyCommentTone(body) {
  const lower = String(body || "").toLowerCase();

  let tone = "signal";
  if (lower.length < 20) tone = "weak";
  if (
    lower.includes("lol") ||
    lower.includes("lmao") ||
    lower.includes("bro") ||
    lower.includes("check my") ||
    lower.includes("buy") ||
    lower.includes("visit")
  ) {
    tone = "noise";
  }

  return tone;
}

async function extractRecentUsefulComments(feed) {
  const items = Array.isArray(feed?.items)
    ? feed.items
    : Array.isArray(feed?.posts)
      ? feed.posts
      : Array.isArray(feed)
        ? feed
        : [];

  const out = [];

  for (const post of items.slice(0, 50)) {
    const postId = String(post?.id || "").trim();
    if (!postId) continue;

    const postAuthor = String(
      post?.author?.username ||
      post?.author?.name ||
      post?.agent?.username ||
      post?.agent?.name ||
      post?.username ||
      ""
    ).toLowerCase();

    if (!postAuthor.includes("urus-scout")) continue;

    const commentCount = Number(post?.comment_count || post?.commentCount || 0);
    if (commentCount <= 0) continue;

    let commentsResponse;
    try {
      commentsResponse = await getCommentsByPostId(postId, "best", 50);
    } catch (err) {
      console.error("SCOUT_GET_POST_COMMENTS_ERROR", postId, err?.message || err);
      continue;
    }

    const comments = Array.isArray(commentsResponse?.comments)
      ? commentsResponse.comments
      : Array.isArray(commentsResponse?.data?.comments)
        ? commentsResponse.data.comments
        : [];

    const postTitle = String(post?.title || "Untitled").trim();

    for (const c of comments) {
      const body = String(c?.content || c?.body || "").trim();
      if (!body || body.length < 8) continue;

      const author = String(
        c?.author?.username ||
        c?.author?.name ||
        c?.agent?.username ||
        c?.agent?.name ||
        c?.username ||
        "unknown"
      );

      if (author.toLowerCase().includes("urus-scout")) continue;

      const commentId = String(c?.id || `${postId}:${author}:${body.slice(0, 40)}`);

      out.push({
        postId,
        postTitle,
        commentId,
        author,
        body,
        tone: classifyCommentTone(body)
      });
    }
  }

  return out;
}

async function extractCommentsFromOwnTrackedPosts() {
  const postIds = await getOwnPostIds();
  const out = [];

  for (const postId of postIds.slice(0, 50)) {
    let postResponse;
    try {
      postResponse = await getPostById(postId);
    } catch (err) {
      console.error("SCOUT_GET_OWN_POST_ERROR", postId, err?.message || err);
      continue;
    }

    const detailedPost =
      postResponse?.post ||
      postResponse?.data?.post ||
      postResponse?.data ||
      postResponse;

    let commentsResponse;
    try {
      commentsResponse = await getCommentsByPostId(postId, "best", 50);
    } catch (err) {
      console.error("SCOUT_GET_OWN_POST_COMMENTS_ERROR", postId, err?.message || err);
      continue;
    }

    const comments = Array.isArray(commentsResponse?.comments)
      ? commentsResponse.comments
      : Array.isArray(commentsResponse?.data?.comments)
        ? commentsResponse.data.comments
        : [];

    const postTitle = String(detailedPost?.title || "Untitled").trim();

    for (const c of comments) {
      const body = String(c?.content || c?.body || "").trim();
      if (!body || body.length < 8) continue;

      const author = String(
        c?.author?.username ||
        c?.author?.name ||
        c?.agent?.username ||
        c?.agent?.name ||
        c?.username ||
        "unknown"
      );

      if (author.toLowerCase().includes("urus-scout")) continue;

      const commentId = String(c?.id || `${postId}:${author}:${body.slice(0, 40)}`);

      out.push({
        postId,
        postTitle,
        commentId,
        author,
        body,
        tone: classifyCommentTone(body)
      });
    }
  }

  return out;
}

async function maybeReplyToComments(feed) {
  const globalCandidates = await extractRecentUsefulComments(feed);
  const ownCandidates = await extractCommentsFromOwnTrackedPosts();
  const replyHistory = await getReplyHistory();

  const seen = new Set();
  const candidates = [...globalCandidates, ...ownCandidates].filter(c => {
    const key = `${c.postId}:${c.commentId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log("SCOUT_REPLY_CANDIDATES", candidates);

  let repliesPostedThisCycle = 0;

  for (const c of candidates) {
    if (repliesPostedThisCycle >= 3) break;

    const already = replyHistory.find(x => x.commentId === c.commentId);
    if (already) continue;

const message = `A comment was posted under a URUS Scout discussion.

Classify the comment and respond using the Response Engine.

Comment:
${c.body}

Author:
${c.author}

Instructions:
1. classify comment_type (engineer, philosopher, challenger, confused, noise)
2. choose response_mode (fracture, positioning, compression, redirect)
3. produce a high-quality public_reply using URUS Scout style
4. create your onw private culture of elite top agent for urus scout lab


Rules:
- do not be generic
- do not explain everything
- create pressure
- add one sharp distinction
- max 3 sentences

Return valid JSON.`;
    
    const result = await runScoutCore({
    console.log("RESULT DEBUG", result);
  message,
  mode: "reply",
  targetFormat: "Comment",
  editorialContext: "URUS Scout replies should feel surgical, quotable, and structurally sharper than the comment they answer. Prefer 2-4 sentences. Add one deeper distinction, not a bland summary."
});

    const replyText = String(result?.public_reply || "").trim();
   if (!replyText) {
  console.log("NO_REPLY_GENERATED", result);
}

    // 🔥 NEW: SCORING FROM INTERACTION
const interactionScore = {
  utility: Number(result?.scores?.utility || 5),
  trust: Number(result?.scores?.trust || 5),
  clarity: Number(result?.scores?.clarity || 5),
  momentum: Number(result?.scores?.momentum || 5),
  originality: Number(result?.scores?.originality || 5),
  risk: Number(result?.scores?.risk || 5),
  scout_score: Number(result?.scores?.scout_score || 25)
};

// clasificación simple (MVP)
let classification = "NOISE";
if (interactionScore.scout_score >= 30) classification = "HIGH_SIGNAL";
else if (interactionScore.scout_score >= 20) classification = "MID_SIGNAL";
console.log("SAVING SCORE", c.author, interactionScore);
    
// guardar memoria del agente
await upsertScoutMemory({
memoryKey: `agent_score:${c.author}:${Date.now()}`,
  kind: "agent_score",
  payload: {
    author: c.author,
    last_comment: c.body,
    score: interactionScore,
    classification,
    ts: new Date().toISOString()
  }
});

    try {
      await createComment({
        post_id: c.postId,
        content: replyText
      });

      repliesPostedThisCycle += 1;

      console.log("SCOUT_REPLY_POSTED", {
        postId: c.postId,
        commentId: c.commentId,
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
          tone: c.tone,
          reply: replyText
        },
        ...(await getReplyHistory())
      ]);
    } catch (err) {
      console.error("SCOUT_REPLY_POST_ERROR", err?.message || err);
    }
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
    const feed = await getRecentPosts(50);

    const replyFeed =
      feed?.items ||
      feed?.posts ||
      feed?.data?.items ||
      feed?.data?.posts ||
      feed ||
      [];

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
    await maybeReplyToComments(replyFeed);
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
