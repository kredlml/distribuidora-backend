module.exports = app => {
  const detalles = require("../controllers/detalle_pedido.controller.js");
  const { verificarToken, isCajero } = require("../middlewares/authJwt.js");
  const { exigirAlcance, cargadores } = require("../utils/alcance.js");
  var router = require("express").Router();
  router.param("id", require("../middlewares/validarId.js"));

  // Agregar/quitar productos modifica la venta y el stock: CAJERO (ADMIN y DISTRITAL también
  // pasan), y solo en pedidos de la propia sucursal.
  router.post("/", [verificarToken, isCajero, exigirAlcance(cargadores.pedidoBody)], detalles.create);
  router.delete("/:id", [verificarToken, isCajero, exigirAlcance(cargadores.detalleParam)], detalles.delete);
  router.get("/", verificarToken, detalles.findAll);
  router.get("/:id", [verificarToken, exigirAlcance(cargadores.detalleParam)], detalles.findOne);

  app.use('/api/detalles', router);
};
