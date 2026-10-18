module.exports = app => {
  const auth = require("../controllers/auth.controller.js");
  const { permitirRegistro } = require("../middlewares/authJwt.js");
  const { limitarIntentos } = require("../middlewares/limitador.js");
  var router = require("express").Router();

  // Solo un ADMIN registra empleados (salvo el primer ADMIN, con la base vacía).
  router.post("/registro", permitirRegistro, auth.registro);
  router.post("/login", limitarIntentos({ max: 20 }), auth.login);

  app.use('/api/auth', router);
};
