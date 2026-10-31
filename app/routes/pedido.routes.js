module.exports = app => {
    const pedidos = require("../controllers/pedido.controller.js");
    const { verificarToken, isCajero } = require("../middlewares/authJwt.js");
    const { exigirAlcance, cargadores } = require("../utils/alcance.js");
    var router = require("express").Router();
    router.param("id", require("../middlewares/validarId.js"));

    // Cada empleado opera solo los pedidos de su sucursal (el DISTRITAL, todos).
    const deMiSucursal = exigirAlcance(cargadores.pedidoParam);
    router.put("/:id/estado", [verificarToken, deMiSucursal], pedidos.actualizarEstado);

    router.get("/:id/historial", [verificarToken, deMiSucursal], pedidos.historial);
    router.post("/cotizar", [verificarToken, isCajero], pedidos.cotizar);
    router.post("/", [verificarToken, isCajero], pedidos.create);
    router.get("/", verificarToken, pedidos.findAll);
    router.get("/:id", [verificarToken, deMiSucursal], pedidos.findOne);

    app.use('/api/pedidos', router);
};
