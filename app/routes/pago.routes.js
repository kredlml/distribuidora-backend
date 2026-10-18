module.exports = app => {
  const pagos = require("../controllers/pago.controller.js");
  const { verificarToken, isCajero } = require("../middlewares/authJwt.js");
  var router = require("express").Router();

  router.post("/", [verificarToken, isCajero], pagos.create);
  router.put("/:id/confirmar", [verificarToken, isCajero], pagos.confirmar);
  router.put("/:id/anular", [verificarToken, isCajero], pagos.anular);
  router.get("/", verificarToken, pagos.findAll);

  app.use('/api/pagos', router);
};
