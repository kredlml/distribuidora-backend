module.exports = app => {
  const productos = require("../controllers/producto.controller.js");
  const authJwt = require("../middlewares/authJwt.js");
  var router = require("express").Router();
  // Alta de prendas: solo ADMIN o BODEGUERO (isBodeguero también deja pasar a ADMIN).
  router.post("/", [authJwt.verificarToken, authJwt.isBodeguero], productos.create);
  router.get("/", productos.findAll);
  router.get("/:id/historial", authJwt.verificarToken, productos.historial);
  app.use('/api/productos', router);
};