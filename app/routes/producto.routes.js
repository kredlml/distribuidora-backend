module.exports = app => {
  const productos = require("../controllers/producto.controller.js");
  var router = require("express").Router();

  router.post("/", productos.create);
  router.get("/", productos.findAll);

  const authJwt = require("../middlewares/authJwt.js");
  router.get("/:id/historial", authJwt.verificarToken, productos.historial);

  app.use('/api/productos', router);
};