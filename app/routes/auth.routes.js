module.exports = app => {
  const auth = require("../controllers/auth.controller.js");
  const { permitirRegistro } = require("../middlewares/authJwt.js");
  var router = require("express").Router();

  // Solo un ADMIN registra empleados (salvo el primer ADMIN, con la base vacía).
  router.post("/registro", permitirRegistro, auth.registro);
  router.post("/login", auth.login);

  app.use('/api/auth', router);
};
