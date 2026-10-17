module.exports = app => {
  const categorias = require("../controllers/categoria.controller.js");
  const { verificarToken, isBodeguero } = require("../middlewares/authJwt.js");
  var router = require("express").Router();
  // Alta de tipos de prenda: solo ADMIN o BODEGUERO.
  router.post("/", [verificarToken, isBodeguero], categorias.create);
  router.get("/", categorias.findAll);
  app.use('/api/categorias', router);
};