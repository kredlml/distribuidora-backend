module.exports = app => {
  const productos = require("../controllers/producto.controller.js");
  const authJwt = require("../middlewares/authJwt.js");
  var router = require("express").Router();
  // Alta de prendas: solo ADMIN o BODEGUERO (isBodeguero también deja pasar a ADMIN).
  router.post("/", [authJwt.verificarToken, authJwt.isBodeguero], productos.create);
  // Editar: ADMIN o BODEGUERO. Eliminar: solo ADMIN (y solo si la prenda no tiene historial).
  router.put("/:id", [authJwt.verificarToken, authJwt.isBodeguero], productos.update);
  router.delete("/:id", [authJwt.verificarToken, authJwt.isAdmin], productos.delete);
  router.get("/", productos.findAll);
  router.get("/:id/historial", authJwt.verificarToken, productos.historial);
  app.use('/api/productos', router);
};