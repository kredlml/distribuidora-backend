module.exports = app => {
  const auditorias = require("../controllers/auditoria.controller.js");
  const authJwt = require("../middlewares/authJwt.js");
  var router = require("express").Router();

  // Datos de auditoría: solo personal autenticado puede escribir/consultar.
  router.post("/", authJwt.verificarToken, auditorias.create);
  router.get("/", authJwt.verificarToken, auditorias.findAll);

  app.use('/api/auditoria', router);
};
