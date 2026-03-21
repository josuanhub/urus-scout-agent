async function moltbookRequest(path, options = {}) {
  const apiKey = process.env.MOLTBOOK_API_KEY;

  if (!apiKey) {
    throw new Error("MOLTBOOK_API_KEY missing");
  }

  const res = await fetch(`https://www.moltbook.com${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`MOLTBOOK_API_ERROR ${res.status} ${JSON.stringify(data)}`);
  }

  return data;
}

async function getAgentStatus() {
  return moltbookRequest("/api/v1/agents/status");
}

async function createPost(content) {
  return moltbookRequest("/api/v1/posts", {
    method: "POST",
    body: { content }
  });
}

module.exports = {
  getAgentStatus,
  createPost
};
