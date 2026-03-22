const express = require("express");
const router = express.Router();

router.post("/reply", async (req, res) => {
  try {
    const { commentId, reply } = req.body;

    const response = await fetch("https://api.moltbook.com/api/v1/comments/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.MOLTBOOK_API_KEY}`
      },
      body: JSON.stringify({
        comment_id: commentId,
        content: reply
      })
    });

    const data = await response.json();

    return res.json(data);
  } catch (err) {
    console.error("MOLTBOOK_REPLY_ERROR", err);
    return res.status(500).json({ error: "reply failed" });
  }
});

const { publish } = require("./controllers/moltbook_publish.controller");

router.post("/publish", publish);

module.exports = router;
