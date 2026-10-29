module.exports = app => {
  const reportes = require("../controllers/reporte.controller.js");

  const authJwt = require("../middlewares/authJwt.js");
  var router = require("express").Router();

  // Cada empleado ve los datos de su sucursal (el DISTRITAL, todas o la que elija).
  router.get("/ventas", authJwt.verificarToken, reportes.historialVentas);
  router.get("/stock-critico", authJwt.verificarToken, reportes.stockCritico);
  // Tablero de ventas para gerentes: ADMIN (su sucursal) y DISTRITAL.
  router.get("/resumen", [authJwt.verificarToken, authJwt.isAdmin], reportes.resumen);

  app.use('/api/reportes', router);
};
