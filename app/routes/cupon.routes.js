module.exports = app => {
  const cupones = require("../controllers/cupon.controller.js");
  const { verificarToken, isDistrital } = require("../middlewares/authJwt.js");
  var router = require("express").Router();
  router.param("id", require("../middlewares/validarId.js"));

  // Promociones: solo el DISTRITAL (gerente distrital) las ve y administra.
  router.get("/", [verificarToken, isDistrital], cupones.findAll);
  router.post("/", [verificarToken, isDistrital], cupones.create);
  router.put("/:id", [verificarToken, isDistrital], cupones.update);
  router.delete("/:id", [verificarToken, isDistrital], cupones.delete);

  app.use('/api/cupones', router);
};
