const BASE_URL = "https://www.moltbook.com/api/v1";

function getHeaders() {
  const apiKey = process.env.MOLTBOOK_API_KEY || "";
  if (!apiKey) {
    throw new Error("MOLTBOOK_API_KEY missing");
  }

  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`
  };
}

async function moltFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...getHeaders(),
      ...(options.headers || {})
    }
  });

  const text = await res.text();
  let data = null;

  try {
    data = JSON.parse(text);
  } catch (_) {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`MOLTBOOK_HTTP_${res.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

async function getAgentStatus() {
  return moltFetch("/agents/status", {
    method: "GET"
  });
}

async function getMe() {
  return moltFetch("/agents/me", {
    method: "GET"
  });
}

async function getRecentPosts(limit = 10) {
  return moltFetch(`/posts?limit=${limit}`, {
    method: "GET"
  });
}

async function getPostById(postId) {
  return moltFetch(`/posts/${postId}`, {
    method: "GET"
  });
}

async function getCommentsByPostId(postId, sort = "best", limit = 50) {
  return moltFetch(`/posts/${postId}/comments?sort=${encodeURIComponent(sort)}&limit=${limit}`, {
    method: "GET"
  });
}

async function createPost({ title, content, submolt_name = "general" }) {
  return moltFetch("/posts", {
    method: "POST",
    body: JSON.stringify({
      title: String(title || "").trim().slice(0, 300),
      content: String(content || "").trim(),
      submolt_name
    })
  });
}

async function createComment({ post_id, content }) {
  return moltFetch(`/posts/${post_id}/comments`, {
    method: "POST",
    body: JSON.stringify({
      content: String(content || "").trim()
    })
  });
}

module.exports = {
  getAgentStatus,
  getMe,
  getRecentPosts,
  getPostById,
  getCommentsByPostId,
  createPost,
  createComment
};
