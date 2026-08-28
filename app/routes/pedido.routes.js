module.exports = app => {
  const pedidos = require("../controllers/pedido.controller.js");
  var router = require("express").Router();

  router.post("/", pedidos.create);
  router.get("/", pedidos.findAll);

  app.use('/api/pedidos', router);
};