module.exports = app => {
  const inventarios = require("../controllers/inventario.controller.js");
  var router = require("express").Router();

  router.post("/", inventarios.create);
  router.get("/", inventarios.findAll);
  router.get("/stock", inventarios.getStockGlobal);

  app.use('/api/inventario', router);
};