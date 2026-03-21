const express = require("express");
const router = express.Router();

const { scout, status } = require("./controllers/urus_scout.controller");

router.post("/scout", scout);
router.get("/status", status);

module.exports = router;
