module.exports = app => {
  const devoluciones = require("../controllers/devolucion.controller.js");
  const { verificarToken, isAdmin, isCajero, isBodeguero } = require("../middlewares/authJwt.js");
  const { exigirAlcance, cargadores } = require("../utils/alcance.js");
  var router = require("express").Router();

  // Cada empleado ve y gestiona solo las devoluciones de pedidos de su sucursal (el DISTRITAL, todas).
  const deMiSucursal = exigirAlcance(cargadores.devolucionParam);

  // Consulta y registro: requieren empleado autenticado. El registro lo hace el
  // cajero (o ADMIN) que atiende el mostrador a nombre del cliente.
  router.post("/", [verificarToken, isCajero, exigirAlcance(cargadores.pedidoBody)], devoluciones.create);
  router.get("/", verificarToken, devoluciones.findAll);
  // Cantidades aún devolvibles por línea de un pedido (apoyo al formulario de solicitud).
  router.get("/pedido/:id_pedido/devolvible", [verificarToken, exigirAlcance(cargadores.pedidoParamIdPedido)], devoluciones.devolvible);
  router.get("/:id", [verificarToken, deMiSucursal], devoluciones.findOne);
  // Línea de tiempo de una devolución (movimientos + auditoría).
  router.get("/:id/historial", [verificarToken, deMiSucursal], devoluciones.historial);

  // Decisión sobre la solicitud: ADMIN (o DISTRITAL).
  router.put("/:id/aprobar", [verificarToken, isAdmin, deMiSucursal], devoluciones.aprobar);
  router.put("/:id/rechazar", [verificarToken, isAdmin, deMiSucursal], devoluciones.rechazar);

  // Operación física y de inventario: BODEGUERO (ADMIN y DISTRITAL también pasan).
  router.put("/:id/recibir", [verificarToken, isBodeguero, deMiSucursal], devoluciones.recibir);
  router.put("/:id/revisar", [verificarToken, isBodeguero, deMiSucursal], devoluciones.revisar);
  router.put("/:id/reintegrar", [verificarToken, isBodeguero, deMiSucursal], devoluciones.reintegrar);
  router.put("/:id/cambiar", [verificarToken, isBodeguero, deMiSucursal], devoluciones.cambiar);

  app.use('/api/devoluciones', router);
};
