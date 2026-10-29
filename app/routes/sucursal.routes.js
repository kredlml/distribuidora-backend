module.exports = app => {
  const sucursales = require("../controllers/sucursal.controller.js");
  const { verificarToken, isDistrital } = require("../middlewares/authJwt.js");
  var router = require("express").Router();
  router.param("id", require("../middlewares/validarId.js"));

  // Abrir, editar y cerrar sucursales es del gerente DISTRITAL.
  router.post("/", [verificarToken, isDistrital], sucursales.create);

  // Recuperar todas las sucursales (público: lo usan el frontend y la tienda)
  router.get("/", sucursales.findAll);

  router.put("/:id", [verificarToken, isDistrital], sucursales.update);

  // Eliminar una sucursal sin historial; con historial se desactiva
  router.delete("/:id", [verificarToken, isDistrital], sucursales.delete);

  // Definir el prefijo base para toda esta ruta
  app.use('/api/sucursales', router);
};
