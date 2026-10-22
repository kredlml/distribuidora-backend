module.exports = app => {
  const empleados = require("../controllers/empleado.controller.js");
  const { verificarToken, isAdmin } = require("../middlewares/authJwt.js");
  var router = require("express").Router();
  router.param("id", require("../middlewares/validarId.js"));

  // Gestión de empleados: solo ADMIN (alta con contraseña en POST /api/auth/registro).
  // No hay DELETE: un empleado que se va se desactiva (activo=false) para conservar su historial.
  router.post("/", [verificarToken, isAdmin], empleados.create);
  router.get("/", [verificarToken, isAdmin], empleados.findAll);
  router.put("/:id", [verificarToken, isAdmin], empleados.update);
  router.put("/:id/password", [verificarToken, isAdmin], empleados.restablecerPassword);

  app.use('/api/empleados', router);
};
