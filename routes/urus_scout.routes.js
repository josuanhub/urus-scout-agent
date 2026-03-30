const express = require("express");
const router = express.Router();

const { scout, status, topAgents } = require("./controllers/urus_scout.controller");

router.post("/scout", scout);
router.get("/status", status);

// 👇 ESTE ES EL NUEVO
router.get("/leaderboard", leaderboard);
router.get("/top-agents", topAgents);

module.exports = router;
