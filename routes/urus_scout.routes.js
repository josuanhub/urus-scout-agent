const express = require("express");
const router = express.Router();

const { scout } = require("./controllers/urus_scout.controller");

router.post("/scout", scout);

module.exports = router;
