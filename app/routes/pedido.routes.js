module.exports = app => {
  const pedidos = require("../controllers/pedido.controller.js");
  var router = require("express").Router();

  
//Defininir, para diferenciar. 
  router.post("/", pedidos.create);
  router.get("/", pedidos.findAll);
  router.get("/:id", pedidos.findOne);
  
  app.use('/api/pedidos', router);
  
};