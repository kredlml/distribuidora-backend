module.exports = app => {
  const empleados = require("../controllers/empleado.controller.js");
  var router = require("express").Router();

  router.post("/", empleados.create);
  router.get("/", empleados.findAll);

  app.use('/api/empleados', router);
};