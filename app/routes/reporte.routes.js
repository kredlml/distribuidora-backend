module.exports = app => {
  const reportes = require("../controllers/reporte.controller.js");
  
  const authJwt = require("../middlewares/authJwt.js");
  var router = require("express").Router();

  
  router.get("/ventas", authJwt.verificarToken, reportes.historialVentas);
  router.get("/stock-critico", authJwt.verificarToken, reportes.stockCritico);

  app.use('/api/reportes', router);
};