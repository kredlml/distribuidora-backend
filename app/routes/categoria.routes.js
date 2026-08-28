module.exports = app => {
  const categorias = require("../controllers/categoria.controller.js");
  var router = require("express").Router();

  router.post("/", categorias.create);
  router.get("/", categorias.findAll);

  app.use('/api/categorias', router);
};