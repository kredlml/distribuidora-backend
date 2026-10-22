module.exports = app => {
  const clientes = require("../controllers/cliente.controller.js");
  const { verificarToken, isCajero } = require("../middlewares/authJwt.js");
  var router = require("express").Router();
  router.param("id", require("../middlewares/validarId.js"));

  // Datos personales de clientes: solo personal autenticado. El alta y edición en mostrador la
  // hace CAJERO/ADMIN (activar/desactivar, solo ADMIN); los clientes de la tienda en línea se
  // registran en /api/tienda/auth/registro o activan su ficha de mostrador con un código.
  router.post("/", [verificarToken, isCajero], clientes.create);
  router.get("/", verificarToken, clientes.findAll);
  router.put("/:id", [verificarToken, isCajero], clientes.update);
  router.post("/:id/codigo-web", [verificarToken, isCajero], clientes.generarCodigoWeb);

  app.use('/api/clientes', router);
};
