module.exports = app => {
  const salud = require("../controllers/salud.controller.js");
  const { verificarToken, isDistrital } = require("../middlewares/authJwt.js");
  var router = require("express").Router();

  // Pública (para el monitor del hosting): solo dice si la API y la base responden.
  router.get("/", salud.salud);
  // Para el DISTRITAL: detalle del sistema y últimos errores registrados.
  router.get("/detalle", [verificarToken, isDistrital], salud.detalle);
  router.get("/errores", [verificarToken, isDistrital], salud.errores);

  app.use('/api/salud', router);
};
