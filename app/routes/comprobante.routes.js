module.exports = app => {
  const comprobantes = require("../controllers/comprobante.controller.js");
  const { verificarToken } = require("../middlewares/authJwt.js");
  var router = require("express").Router();
  router.param("id", require("../middlewares/validarId.js"));

  // Solo lectura: los comprobantes los emite el sistema al mover stock y no se editan ni se borran.
  // Cada empleado ve los de su sucursal; el DISTRITAL, todos.
  router.get("/", verificarToken, comprobantes.findAll);
  router.get("/:id", verificarToken, comprobantes.findOne);

  app.use('/api/comprobantes', router);
};
