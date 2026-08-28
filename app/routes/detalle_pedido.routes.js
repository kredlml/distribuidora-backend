module.exports = app => {
  const detalles = require("../controllers/detalle_pedido.controller.js");
  var router = require("express").Router();

  router.post("/", detalles.create);
  router.get("/", detalles.findAll);

  app.use('/api/detalles', router);
};