module.exports = app => {
  const proveedores = require("../controllers/proveedor.controller.js");
  const { verificarToken, isBodeguero } = require("../middlewares/authJwt.js");
  var router = require("express").Router();

  // Proveedores: datos de contacto internos. Alta: ADMIN o BODEGUERO; consulta: empleados.
  router.post("/", [verificarToken, isBodeguero], proveedores.create);
  router.get("/", verificarToken, proveedores.findAll);

  app.use('/api/proveedores', router);
};
