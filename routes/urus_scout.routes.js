const express = require("express");
const router = express.Router();

router.post("/scout", async (req, res) => {
  return res.json({
    ok: true,
    route: "urus_scout",
    message: "Ruta scout activa"
  });
});

module.exports = router;
