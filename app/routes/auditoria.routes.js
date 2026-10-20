module.exports = app => {
  const auditorias = require("../controllers/auditoria.controller.js");
  const authJwt = require("../middlewares/authJwt.js");
  var router = require("express").Router();

  // Auditoría: solo ADMIN (contiene correos y puestos del personal, y no debe poder falsificarse).
  router.post("/", [authJwt.verificarToken, authJwt.isAdmin], auditorias.create);
  router.get("/", [authJwt.verificarToken, authJwt.isAdmin], auditorias.findAll);

  app.use('/api/auditoria', router);
};
