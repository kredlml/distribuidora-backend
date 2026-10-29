module.exports = app => {
  const auditorias = require("../controllers/auditoria.controller.js");
  const authJwt = require("../middlewares/authJwt.js");
  var router = require("express").Router();

  // Auditoría: solo el DISTRITAL (contiene datos de todas las sucursales y del personal, y no
  // debe poder falsificarse).
  router.post("/", [authJwt.verificarToken, authJwt.isDistrital], auditorias.create);
  router.get("/", [authJwt.verificarToken, authJwt.isDistrital], auditorias.findAll);

  app.use('/api/auditoria', router);
};
