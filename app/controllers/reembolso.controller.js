const db = require("../models");
const { registrarAuditoria } = require("../utils/auditoria");
const { whereSucursal } = require("../utils/alcance");
const { procesarEnStripe } = require("../utils/reembolsos");
const { esIdValido } = require("../middlewares/validarId");

const INCLUDE_PEDIDO = (req) => {
  const alcance = whereSucursal(req);
  return {
    model: db.pedido, attributes: ["id_pedido", "id_sucursal", "id_cliente"], where: Object.keys(alcance).length ? alcance : undefined,
    include: [{ model: db.cliente, attributes: ["id_cliente", "nombre", "apellido"] }, { model: db.sucursal, attributes: ["id_sucursal", "nombre"] }]
  };
};

// GET /api/reembolsos?estado=PENDIENTE&id_pedido=&id_devolucion= — los de la propia sucursal (el DISTRITAL, todos).
exports.findAll = async (req, res) => {
  try {
    const where = {};
    if (req.query.estado) {
      const estados = String(req.query.estado).split(",").map((e) => e.trim());
      if (!estados.every((e) => ["PENDIENTE", "COMPLETADO", "FALLIDO"].includes(e))) return res.status(400).send({ message: "Estado inválido." });
      where.estado = estados;
    }
    for (const c of ["id_pedido", "id_devolucion"]) {
      if (req.query[c] === undefined) continue;
      if (!esIdValido(req.query[c])) return res.status(400).send({ message: `${c} debe ser un número válido.` });
      where[c] = Number(req.query[c]);
    }
    const data = await db.reembolso.findAll({ where, include: [INCLUDE_PEDIDO(req), { model: db.empleado, attributes: ["id_empleado", "nombre", "apellido"] }], order: [["id_reembolso", "DESC"]] });
    res.send(data);
  } catch (error) {
    res.status(500).send({ message: "Error al recuperar los reembolsos." });
  }
};

// Carga el reembolso bloqueado y verifica que sea de la sucursal del empleado.
async function reembolsoDeMiSucursal(req, t) {
  const r = await db.reembolso.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
  if (!r) return null;
  const pedido = await db.pedido.findByPk(r.id_pedido, { attributes: ["id_sucursal"], transaction: t });
  const alcance = whereSucursal(req);
  if (alcance.id_sucursal && pedido.id_sucursal !== alcance.id_sucursal) return null;
  return r;
}

// PUT /api/reembolsos/:id/completar { referencia? } — caja confirma que entregó el dinero
// (efectivo, reversión en el POS o PayPal). Los de tarjeta en línea los completa Stripe; solo si
// Stripe lo rechazó (FALLIDO) caja puede entregarlo en efectivo para no dejar a la clienta sin su dinero.
exports.completar = async (req, res) => {
  try {
    const referencia = req.body && req.body.referencia != null ? String(req.body.referencia).trim() : "";
    if (referencia.length > 150) return res.status(400).send({ message: "La referencia no puede superar los 150 caracteres." });
    const resultado = await db.sequelize.transaction(async (t) => {
      const r = await reembolsoDeMiSucursal(req, t);
      if (!r) return { status: 404, message: `No se encontró el reembolso con id=${req.params.id}.` };
      const stripeFallido = r.metodo === "STRIPE" && r.estado === "FALLIDO";
      if (r.metodo === "STRIPE" && !stripeFallido) {
        return { status: 400, message: r.estado === "PENDIENTE" ? "Los reembolsos a la tarjeta en línea los procesa Stripe: usa «Reintentar» si quedó pendiente." : `El reembolso ya está ${r.estado}.` };
      }
      if (!stripeFallido && r.estado !== "PENDIENTE") return { status: 400, message: `El reembolso ya está ${r.estado}.` };
      await r.update({
        estado: "COMPLETADO", fecha_completado: new Date(), id_empleado: req.empleadoId,
        // Un Stripe fallido pasa a EFECTIVO (así se devolvió); conserva id_pago y el id de Stripe, y la
        // referencia de caja va en la observación.
        ...(stripeFallido
          ? { metodo: "EFECTIVO", observacion: `Stripe no pudo devolverlo a la tarjeta; se entregó en efectivo en caja.${referencia ? " Ref.: " + referencia : ""}`.slice(0, 255) }
          : { id_transaccion_externa: referencia || null })
      }, { transaction: t });
      await registrarAuditoria({
        id_empleado: req.empleadoId, accion: "REEMBOLSO_COMPLETADO", tabla_afectada: "Reembolso", registro_afectado_id: r.id_reembolso,
        detalles: `Reembolso #${r.id_reembolso} de ${Number(r.monto).toFixed(2)} (${stripeFallido ? "STRIPE fallido, en efectivo" : r.metodo}) entregado en caja.${referencia ? " Ref.: " + referencia : ""}`.slice(0, 255)
      }, t);
      return { status: 200, r };
    });
    if (resultado.status !== 200) return res.status(resultado.status).send({ message: resultado.message });
    res.send({ message: `Reembolso de ${Number(resultado.r.monto).toFixed(2)} registrado como entregado.`, reembolso: resultado.r });
    require("../utils/notificaciones").reembolsoCompletado(resultado.r.id_reembolso);
  } catch (error) {
    res.status(500).send({ message: "Error al completar el reembolso." });
  }
};

// POST /api/reembolsos/:id/reintentar — vuelve a pedir (o consultar) en Stripe un reembolso a
// tarjeta que quedó PENDIENTE (Stripe no respondió o lo está procesando). Es idempotente.
exports.reintentar = async (req, res) => {
  try {
    const r = await db.sequelize.transaction(async (t) => reembolsoDeMiSucursal(req, t));
    if (!r) return res.status(404).send({ message: `No se encontró el reembolso con id=${req.params.id}.` });
    if (r.metodo !== "STRIPE" || r.estado !== "PENDIENTE") return res.status(400).send({ message: "Solo se reintentan reembolsos a tarjeta en línea que siguen pendientes." });
    // procesarEnStripe avisa a la clienta y nunca lanza; aquí solo se explica el resultado.
    const final = await procesarEnStripe(r.id_reembolso, req.empleadoId);
    const ocupado = final.estado === "PENDIENTE" && final.procesando_desde;
    const message = final.estado === "COMPLETADO" ? "Reembolso completado en Stripe."
      : final.estado === "FALLIDO" ? "Stripe rechazó el reembolso: entrégalo en efectivo con «Entregar en efectivo»."
      : ocupado ? "Otra persona lo está procesando en este momento; actualiza en unos segundos."
      : final.observacion && final.observacion.startsWith("Stripe:") ? `Stripe no respondió bien (${final.observacion.slice(8)}). Intenta de nuevo en unos minutos.`
      : "Stripe aún lo está procesando.";
    res.send({ message, reembolso: final });
  } catch (error) {
    res.status(500).send({ message: "Error al reintentar el reembolso." });
  }
};
