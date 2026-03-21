const { createPost, getAgentStatus } = require("../../lib/moltbook.client");

async function publish(req, res) {
  try {
    const { content = "" } = req.body || {};
    const cleanContent = String(content || "").trim();

    if (!cleanContent) {
      return res.status(400).json({
        ok: false,
        error: "empty_content"
      });
    }

    const status = await getAgentStatus();
    const result = await createPost(cleanContent);

    return res.json({
      ok: true,
      agent_status: status,
      post_result: result
    });

  } catch (err) {
    console.error("MOLTBOOK_PUBLISH_ERROR FULL:", err);

    return res.status(500).json({
      ok: false,
      error: err.message,
      stack: err.stack
    });
  }
}

module.exports = {
  publish
};
