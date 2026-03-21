const express = require("express");
const router = express.Router();

const { publish } = require("./controllers/moltbook_publish.controller");

router.post("/publish", publish);

module.exports = router;
