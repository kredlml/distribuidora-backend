module.exports = app => {
  const inventarios = require("../controllers/inventario.controller.js");
  var router = require("express").Router();

  router.post("/", inventarios.create);
  router.get("/", inventarios.findAll);

  app.use('/api/inventario', router);
};