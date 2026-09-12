module.exports = app => {
  const devoluciones = require("../controllers/devolucion.controller.js");
  const { verificarToken, isAdmin, isBodeguero } = require("../middlewares/authJwt.js");
  var router = require("express").Router();

  // El cliente (o el vendedor que atiende el mostrador) registra la solicitud.
  router.post("/", devoluciones.create);
  router.get("/", devoluciones.findAll);
  router.get("/:id", devoluciones.findOne);

  // Decisión inicial de la solicitud: solo Admin.
  router.put("/:id/aprobar", [verificarToken, isAdmin], devoluciones.aprobar);
  router.put("/:id/rechazar", [verificarToken, isAdmin], devoluciones.rechazar);

  // Operaciones físicas sobre la prenda/inventario: Bodeguero (o Admin).
  router.put("/:id/recibir", [verificarToken, isBodeguero], devoluciones.recibir);
  router.put("/:id/revisar", [verificarToken, isBodeguero], devoluciones.revisar);
  router.put("/:id/reintegrar", [verificarToken, isBodeguero], devoluciones.reintegrar);
  router.put("/:id/cambiar", [verificarToken, isBodeguero], devoluciones.cambiar);

  app.use('/api/devoluciones', router);
};
