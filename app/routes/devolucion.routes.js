module.exports = app => {
  const devoluciones = require("../controllers/devolucion.controller.js");
  const { verificarToken, isAdmin, isCajero, isBodeguero } = require("../middlewares/authJwt.js");
  var router = require("express").Router();

  // Consulta y registro: requieren empleado autenticado. El registro lo hace el
  // cajero (o ADMIN) que atiende el mostrador a nombre del cliente.
  router.post("/", [verificarToken, isCajero], devoluciones.create);
  router.get("/", verificarToken, devoluciones.findAll);
  router.get("/:id", verificarToken, devoluciones.findOne);

  // Decisión sobre la solicitud: ADMIN.
  router.put("/:id/aprobar", [verificarToken, isAdmin], devoluciones.aprobar);
  router.put("/:id/rechazar", [verificarToken, isAdmin], devoluciones.rechazar);

  // Operación física y de inventario: BODEGUERO (ADMIN también pasa).
  router.put("/:id/recibir", [verificarToken, isBodeguero], devoluciones.recibir);
  router.put("/:id/revisar", [verificarToken, isBodeguero], devoluciones.revisar);
  router.put("/:id/reintegrar", [verificarToken, isBodeguero], devoluciones.reintegrar);
  router.put("/:id/cambiar", [verificarToken, isBodeguero], devoluciones.cambiar);

  app.use('/api/devoluciones', router);
};
