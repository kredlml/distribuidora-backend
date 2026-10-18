module.exports = app => {
  const detalles = require("../controllers/detalle_pedido.controller.js");
  const { verificarToken, isCajero } = require("../middlewares/authJwt.js");
  var router = require("express").Router();

  // Agregar/quitar productos modifica la venta y el stock: CAJERO (ADMIN también pasa).
  router.post("/", [verificarToken, isCajero], detalles.create);
  router.delete("/:id", [verificarToken, isCajero], detalles.delete);
  router.get("/", verificarToken, detalles.findAll);
  router.get("/:id", verificarToken, detalles.findOne);

  app.use('/api/detalles', router);
};
