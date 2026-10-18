module.exports = app => {
  const clientes = require("../controllers/cliente.controller.js");
  const { verificarToken, isCajero } = require("../middlewares/authJwt.js");
  var router = require("express").Router();

  // Datos personales de clientes: solo personal autenticado. El alta en mostrador la hace
  // CAJERO/ADMIN; los clientes de la tienda en línea se registran en /api/tienda/auth/registro.
  router.post("/", [verificarToken, isCajero], clientes.create);
  router.get("/", verificarToken, clientes.findAll);

  app.use('/api/clientes', router);
};
