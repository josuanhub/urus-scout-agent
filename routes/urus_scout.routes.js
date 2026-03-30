const express = require("express");
const router = express.Router();

const { scout, status, leaderboard } = require("./controllers/urus_scout.controller");

router.post("/scout", scout);
router.get("/status", status);

// 👇 ESTE ES EL NUEVO
router.get("/leaderboard", leaderboard);

module.exports = router;
