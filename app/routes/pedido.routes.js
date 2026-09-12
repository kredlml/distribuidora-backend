module.exports = app => {
  const pedidos = require("../controllers/pedido.controller.js");
  const { verificarToken, isCajero } = require("../middlewares/authJwt.js"); 
  var router = require("express").Router();
  
//Defininir, para diferenciar. 
  router.post("/", pedidos.create);
  router.get("/", pedidos.findAll);
  router.put("/:id/estado", pedidos.updateEstado);

  router.post("/", [verificarToken, isCajero], pedidos.create);
  
  
  router.get("/", verificarToken, pedidos.findAll);
  router.get("/:id", verificarToken, pedidos.findOne);
  
  app.use('/api/pedidos', router);
};