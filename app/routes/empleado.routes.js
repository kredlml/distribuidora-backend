module.exports = app => {
  const empleados = require("../controllers/empleado.controller.js");
  const { verificarToken, isAdmin } = require("../middlewares/authJwt.js");
  var router = require("express").Router();

  // Alta de empleados: solo ADMIN. Consulta: cualquier empleado autenticado.
  router.post("/", [verificarToken, isAdmin], empleados.create);
  router.get("/", verificarToken, empleados.findAll);

  app.use('/api/empleados', router);
};
