const express = require("express");
const urusScoutRoutes = require("./routes/urus_scout.routes");
const { ensureScoutSchema } = require("./lib/scout.db");
const { startScoutLoop } = require("./lib/scout.loop");

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use("/v1/urus_scout", urusScoutRoutes);

app.get("/", async (req, res) => {
  return res.json({
    ok: true,
    module: "urus_scout_agent",
    status: "online"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`URUS Scout running on port ${PORT}`);

  try {
    await ensureScoutSchema();
    console.log("SCOUT_DB_READY");
    startScoutLoop();
  } catch (err) {
    console.error("SCOUT_BOOT_ERROR", err?.message || err);
  }
});
