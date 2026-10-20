module.exports = app => {
  const auth = require("../controllers/auth.controller.js");
  const { permitirRegistro, verificarToken } = require("../middlewares/authJwt.js");
  const { limitarIntentos } = require("../middlewares/limitador.js");
  var router = require("express").Router();

  // Solo un ADMIN registra empleados (salvo el primer ADMIN, con la base vacía).
  // No hay auto-registro público: el panel lo hace desde la pantalla Empleados.
  router.post("/registro", permitirRegistro, auth.registro);
  router.post("/login", limitarIntentos({ max: 20 }), auth.login);
  // Sesión actual y cambio de la propia contraseña (cualquier empleado autenticado).
  router.get("/yo", verificarToken, auth.yo);
  router.put("/password", [limitarIntentos({ max: 10 }), verificarToken], auth.cambiarPassword);

  app.use('/api/auth', router);
};
