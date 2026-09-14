module.exports = app => {
    const pedidos = require("../controllers/pedido.controller.js");
    const { verificarToken, isCajero } = require("../middlewares/authJwt.js");
    var router = require("express").Router();

    
    router.put("/:id/estado", verificarToken, pedidos.actualizarEstado);
  
    router.get("/:id/historial", verificarToken, pedidos.historial);
    router.post("/", [verificarToken, isCajero], pedidos.create);
    router.get("/", verificarToken, pedidos.findAll);
    router.get("/:id", verificarToken, pedidos.findOne);
  
    app.use('/api/pedidos', router);
};