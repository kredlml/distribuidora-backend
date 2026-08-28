module.exports = app => {
  const proveedores = require("../controllers/proveedor.controller.js");
  var router = require("express").Router();

  router.post("/", proveedores.create);
  router.get("/", proveedores.findAll);

  app.use('/api/proveedores', router);
};