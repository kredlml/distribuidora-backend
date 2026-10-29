module.exports = app => {
  const pagos = require("../controllers/pago.controller.js");
  const { verificarToken, isCajero } = require("../middlewares/authJwt.js");
  const { exigirAlcance, cargadores } = require("../utils/alcance.js");
  var router = require("express").Router();
  router.param("id", require("../middlewares/validarId.js"));

  // Solo se cobran y gestionan pagos de pedidos de la propia sucursal (el DISTRITAL, todos).
  router.post("/", [verificarToken, isCajero, exigirAlcance(cargadores.pedidoBody)], pagos.create);
  const deMiSucursal = exigirAlcance(cargadores.pagoParam);
  router.put("/:id/confirmar", [verificarToken, isCajero, deMiSucursal], pagos.confirmar);
  router.put("/:id/anular", [verificarToken, isCajero, deMiSucursal], pagos.anular);
  // Devolver al cliente un cobro presencial (efectivo/POS) de un pedido que sigue PENDIENTE.
  router.put("/:id/devolver", [verificarToken, isCajero, deMiSucursal], pagos.devolver);
  router.get("/", verificarToken, pagos.findAll);

  app.use('/api/pagos', router);
};
