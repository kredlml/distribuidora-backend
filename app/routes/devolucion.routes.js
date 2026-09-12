module.exports = app => {
  const devoluciones = require("../controllers/devolucion.controller.js");
  const authJwt = require("../middlewares/authJwt.js");
  var router = require("express").Router();

  // El cliente registra la solicitud.
  router.post("/", devoluciones.create);
  router.get("/", devoluciones.findAll);
  router.get("/:id", devoluciones.findOne);

  // Operaciones administrativas: requieren empleado autenticado, igual que /api/reportes.
  router.put("/:id/aprobar", authJwt.verificarToken, devoluciones.aprobar);
  router.put("/:id/rechazar", authJwt.verificarToken, devoluciones.rechazar);
  router.put("/:id/recibir", authJwt.verificarToken, devoluciones.recibir);
  router.put("/:id/revisar", authJwt.verificarToken, devoluciones.revisar);
  router.put("/:id/reintegrar", authJwt.verificarToken, devoluciones.reintegrar);
  router.put("/:id/cambiar", authJwt.verificarToken, devoluciones.cambiar);

  app.use('/api/devoluciones', router);
};
