const express = require("express");

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/", async (req, res) => {
  return res.json({
    ok: true,
    module: "urus_scout_agent",
    status: "online"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`URUS Scout running on port ${PORT}`);
});
