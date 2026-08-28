module.exports = app => {
  const clientes = require("../controllers/cliente.controller.js");
  var router = require("express").Router();

  router.post("/", clientes.create);
  router.get("/", clientes.findAll);

  app.use('/api/clientes', router);
};