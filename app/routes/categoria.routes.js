module.exports = app => {
  const categorias = require("../controllers/categoria.controller.js");
  const { verificarToken, isDistrital } = require("../middlewares/authJwt.js");
  var router = require("express").Router();
  router.param("id", require("../middlewares/validarId.js"));
  // Tipos de prenda: parte del catálogo único, solo el DISTRITAL los crea, edita y elimina.
  router.post("/", [verificarToken, isDistrital], categorias.create);
  router.put("/:id", [verificarToken, isDistrital], categorias.update);
  router.delete("/:id", [verificarToken, isDistrital], categorias.delete);
  router.get("/", categorias.findAll);
  app.use('/api/categorias', router);
};
