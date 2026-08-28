module.exports = app => {
  const sucursales = require("../controllers/sucursal.controller.js");
  var router = require("express").Router();

  // Crear una nueva sucursal
  router.post("/", sucursales.create);

  // Recuperar todas las sucursales
  router.get("/", sucursales.findAll);

  // Actualizar una sucursal por id
  router.put("/:id", sucursales.update);

  // Definir el prefijo base para toda esta ruta
  app.use('/api/sucursales', router);
};