module.exports = app => {
  const sucursales = require("../controllers/sucursal.controller.js");
  const { verificarToken, isAdmin } = require("../middlewares/authJwt.js");
  var router = require("express").Router();
  router.param("id", require("../middlewares/validarId.js"));

  // Crear una nueva sucursal (solo ADMIN)
  router.post("/", [verificarToken, isAdmin], sucursales.create);

  // Recuperar todas las sucursales (público: lo usan el frontend y la tienda)
  router.get("/", sucursales.findAll);

  // Actualizar una sucursal por id (solo ADMIN)
  router.put("/:id", [verificarToken, isAdmin], sucursales.update);

  // Eliminar una sucursal sin historial (solo ADMIN); con historial se desactiva
  router.delete("/:id", [verificarToken, isAdmin], sucursales.delete);

  // Definir el prefijo base para toda esta ruta
  app.use('/api/sucursales', router);
};
