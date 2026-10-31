module.exports = app => {
  const reembolsos = require("../controllers/reembolso.controller.js");
  const { verificarToken, isCajero } = require("../middlewares/authJwt.js");
  var router = require("express").Router();
  router.param("id", require("../middlewares/validarId.js"));

  // Reembolsos de devoluciones: los ve el personal de la sucursal; los entrega/reintenta caja
  // (CAJERO, ADMIN o DISTRITAL). Cada uno solo los de su sucursal.
  router.get("/", verificarToken, reembolsos.findAll);
  router.put("/:id/completar", [verificarToken, isCajero], reembolsos.completar);
  router.post("/:id/reintentar", [verificarToken, isCajero], reembolsos.reintentar);

  app.use('/api/reembolsos', router);
};
