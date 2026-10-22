module.exports = app => {
  const proveedores = require("../controllers/proveedor.controller.js");
  const { verificarToken, isBodeguero, isAdmin } = require("../middlewares/authJwt.js");
  var router = require("express").Router();
  router.param("id", require("../middlewares/validarId.js"));

  // Proveedores: datos de contacto internos. Alta y edición: ADMIN o BODEGUERO; eliminar: ADMIN;
  // consulta: empleados.
  router.post("/", [verificarToken, isBodeguero], proveedores.create);
  router.get("/", verificarToken, proveedores.findAll);
  router.put("/:id", [verificarToken, isBodeguero], proveedores.update);
  router.delete("/:id", [verificarToken, isAdmin], proveedores.delete);

  app.use('/api/proveedores', router);
};
