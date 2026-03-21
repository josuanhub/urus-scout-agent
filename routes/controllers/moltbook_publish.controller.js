const { createPost } = require("../../lib/moltbook.client");

async function publish(req, res) {
  try {
    const { title = "", content = "", submolt_name = "general" } = req.body || {};

    const cleanTitle = String(title || "").trim().slice(0, 300);
    const cleanContent = String(content || "").trim();

    if (!cleanTitle) {
      return res.status(400).json({
        ok: false,
        error: "title_required"
      });
    }

    if (!cleanContent) {
      return res.status(400).json({
        ok: false,
        error: "content_required"
      });
    }

    const result = await createPost({
      title: cleanTitle,
      content: cleanContent,
      submolt_name
    });

    return res.json({
      ok: true,
      result
    });
  } catch (err) {
    console.error("MOLTBOOK_PUBLISH_ERROR", err?.message || err);

    return res.status(500).json({
      ok: false,
      error: err?.message || "publish_failed",
      stack: err?.stack || null
    });
  }
}

module.exports = {
  publish
};
