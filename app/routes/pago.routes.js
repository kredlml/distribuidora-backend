module.exports = app => {
  const pagos = require("../controllers/pago.controller.js");
  const { verificarToken, isCajero } = require("../middlewares/authJwt.js");
  var router = require("express").Router();
  router.param("id", require("../middlewares/validarId.js"));

  router.post("/", [verificarToken, isCajero], pagos.create);
  router.put("/:id/confirmar", [verificarToken, isCajero], pagos.confirmar);
  router.put("/:id/anular", [verificarToken, isCajero], pagos.anular);
  // Devolver al cliente un cobro presencial (efectivo/POS) de un pedido que sigue PENDIENTE.
  router.put("/:id/devolver", [verificarToken, isCajero], pagos.devolver);
  router.get("/", verificarToken, pagos.findAll);

  app.use('/api/pagos', router);
};
