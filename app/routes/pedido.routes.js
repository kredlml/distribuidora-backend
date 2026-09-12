module.exports = app => {
  const pedidos = require("../controllers/pedido.controller.js");
  const { verificarToken, isCajero } = require("../middlewares/authJwt.js"); 
  var router = require("express").Router();
  
//Defininir, para diferenciar. 
  router.post("/", pedidos.create);
  router.get("/", pedidos.findAll);
  router.put("/:id/estado", pedidos.updateEstado); // el de ale
  router.post("/", [verificarToken, isCajero], pedidos.create);
  router.get("/:id/estado", verificarToken, pedidos.actualizarEstado); // el de carlos
  router.get("/:id/historial", verificarToken, pedidos.historial);

    app.use("/api/pedidos", router);
};