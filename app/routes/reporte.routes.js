module.exports = app => {
  const reportes = require("../controllers/reporte.controller.js");
  var router = require("express").Router();

  // GET /api/reportes/ventas
  router.get("/ventas", reportes.historialVentas);

  // GET /api/reportes/stock-critico
  router.get("/stock-critico", reportes.stockCritico);

  app.use('/api/reportes', router);
};