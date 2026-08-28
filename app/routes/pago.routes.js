module.exports = app => {
  const pagos = require("../controllers/pago.controller.js");
  var router = require("express").Router();

  router.post("/", pagos.create);
  router.get("/", pagos.findAll);

  app.use('/api/pagos', router);
};