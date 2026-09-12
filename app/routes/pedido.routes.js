module.exports = app => {
    const pedidos = require("../controllers/pedido.controller.js");
    const { verificarToken, isCajero } = require("../middlewares/authJwt.js");
    var router = require("express").Router();

    router.post("/", [verificarToken, isCajero], pedidos.create);

    router.get("/", verificarToken, pedidos.findAll);
    router.get("/:id", verificarToken, pedidos.findOne);
    router.get("/:id/estado", verificarToken, pedidos.actualizarEstado);
    router.get("/:id/historial", verificarToken, pedidos.historial);

    app.use("/api/pedidos", router);
};