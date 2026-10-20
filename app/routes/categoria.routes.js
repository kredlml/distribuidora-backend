module.exports = app => {
  const categorias = require("../controllers/categoria.controller.js");
  const { verificarToken, isBodeguero, isAdmin } = require("../middlewares/authJwt.js");
  var router = require("express").Router();
  // Alta y edición de tipos de prenda: ADMIN o BODEGUERO. Eliminar: solo ADMIN (igual que las prendas).
  router.post("/", [verificarToken, isBodeguero], categorias.create);
  router.put("/:id", [verificarToken, isBodeguero], categorias.update);
  router.delete("/:id", [verificarToken, isAdmin], categorias.delete);
  router.get("/", categorias.findAll);
  app.use('/api/categorias', router);
};
