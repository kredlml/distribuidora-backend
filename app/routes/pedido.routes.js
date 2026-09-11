module.exports = app => {
  const pedidos = require("../controllers/pedido.controller.js");
  var router = require("express").Router();

  
//Defininir, para diferenciar. 
  const authJwt = require("../middlewares/authJwt.js");

  router.post("/", pedidos.create);
  router.get("/", pedidos.findAll);
  router.get("/:id", pedidos.findOne);
  router.put("/:id/estado", authJwt.verificarToken, pedidos.actualizarEstado);
  router.get("/:id/historial", authJwt.verificarToken, pedidos.historial);
  
  app.use('/api/pedidos', router);
  
};