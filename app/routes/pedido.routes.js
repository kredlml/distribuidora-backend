module.exports = app => {
  const pedidos = require("../controllers/pedido.controller.js");
  var router = require("express").Router();

  
//Defininir, para diferenciar. 
  const { verificarToken, isCajero } = require("../middlewares/authJwt.js");

  router.post("/", pedidos.create);
  router.get("/", pedidos.findAll);
  router.get("/:id", pedidos.findOne);
  router.put("/:id/estado", [verificarToken, isCajero], pedidos.actualizarEstado);
  router.get("/:id/historial", verificarToken, pedidos.historial);
  
  app.use('/api/pedidos', router);
  
};