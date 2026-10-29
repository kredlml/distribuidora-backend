module.exports = app => {
  const productos = require("../controllers/producto.controller.js");
  const authJwt = require("../middlewares/authJwt.js");
  var router = require("express").Router();
  router.param("id", require("../middlewares/validarId.js"));
  // El catálogo es uno solo para todas las sucursales: lo crean, editan y eliminan solo el
  // DISTRITAL (eliminar, solo si la prenda no tiene historial). Cada sucursal maneja su stock.
  router.post("/", [authJwt.verificarToken, authJwt.isDistrital], productos.create);
  router.put("/:id", [authJwt.verificarToken, authJwt.isDistrital], productos.update);
  router.delete("/:id", [authJwt.verificarToken, authJwt.isDistrital], productos.delete);
  router.get("/", productos.findAll);
  // Trazabilidad de una prenda: cada empleado ve los movimientos de su sucursal.
  router.get("/:id/historial", authJwt.verificarToken, productos.historial);
  app.use('/api/productos', router);
};
