module.exports = app => {
  const inventarios = require("../controllers/inventario.controller.js");
  const { verificarToken, isBodeguero } = require("../middlewares/authJwt.js");

  var router = require("express").Router();

  // Ingreso de stock y bajas (ajustes): ADMIN o BODEGUERO.
  router.post("/", [verificarToken, isBodeguero], inventarios.create);
  router.post("/ingresos", [verificarToken, isBodeguero], inventarios.ingresar);
  router.post("/ajustes", [verificarToken, isBodeguero], inventarios.ajustar);

  router.get("/", verificarToken, inventarios.findAll);
  router.get("/stock", verificarToken, inventarios.getStockGlobal);

  app.use('/api/inventario', router);
};
