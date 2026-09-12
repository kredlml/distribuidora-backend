module.exports = app => {
  const auditorias = require("../controllers/auditoria.controller.js");
  const { verificarToken, isAdmin } = require("../middlewares/authJwt.js");
  var router = require("express").Router();

  // Datos de auditoría: son sensibles, solo Admin puede escribir/consultar.
  router.post("/", [verificarToken, isAdmin], auditorias.create);
  router.get("/", [verificarToken, isAdmin], auditorias.findAll);

  app.use('/api/auditoria', router);
};
