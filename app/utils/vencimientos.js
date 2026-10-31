const db = require("../models");
const { registrarAuditoria } = require("./auditoria");
const { cancelarPedido, registrarCobroExitoso, totalPagado } = require("./facturacion");
const pagosStripe = require("./pagosStripe");

// Vencimiento automático de pedidos PENDIENTES de pago: si en PLAZO_PEDIDO_PENDIENTE_HORAS (24 por
// defecto; 0 lo desactiva) no se pagaron, se cancelan, el stock reservado vuelve a estar disponible
// y, si había un cobro con tarjeta iniciado, se cancela en Stripe. Una revisión corre cada
// VENCIMIENTO_INTERVALO_MIN minutos (10 por defecto).
//  - No se cancelan los que ya tienen algún pago completado (pago parcial): los resuelve caja.
//  - Tampoco los que tienen un pago de caja por confirmar, o un cobro con tarjeta iniciado hace
//    menos de MINUTOS_GRACIA (la clienta podría estar escribiendo la tarjeta).
//  - Si Stripe ya cobró, se registra el cobro (el pedido pasa a PROCESADO) en vez de cancelar.

const leerNumero = (v, porDefecto) => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? porDefecto : Number(v));
const HORAS_PEDIDO_PENDIENTE = Math.max(0, leerNumero(process.env.PLAZO_PEDIDO_PENDIENTE_HORAS, 24));
const INTERVALO_MS = Math.max(0.01, leerNumero(process.env.VENCIMIENTO_INTERVALO_MIN, 10)) * 60 * 1000;
const MINUTOS_GRACIA = 30;
const CANDADO = 74210532; // una sola instancia del servidor revisa a la vez

const plazoMs = () => HORAS_PEDIDO_PENDIENTE * 3600 * 1000;
// Hasta cuándo puede pagarse un pedido PENDIENTE (null si no vence o no está pendiente).
const venceEl = (pedido) => (HORAS_PEDIDO_PENDIENTE > 0 && pedido && pedido.estado === "PENDIENTE" && pedido.fecha_pedido
  ? new Date(new Date(pedido.fecha_pedido).getTime() + plazoMs()) : null);
const estaVencido = (pedido, ahora = new Date()) => { const v = venceEl(pedido); return !!v && v <= ahora; };

// Intenta vencer un pedido. Devuelve 'cancelado', 'cobrado' (Stripe ya había cobrado), u 'omitido'.
async function vencerPedido(id_pedido) {
  const t = await db.sequelize.transaction();
  let resultado = "omitido";
  try {
    // Orden de bloqueo: pagos y luego el pedido (igual que la tienda y el webhook).
    await db.pago.findAll({ where: { id_pedido, estado_pago: "PENDIENTE" }, order: [["id_pago", "ASC"]], transaction: t, lock: t.LOCK.UPDATE });
    const pedido = await db.pedido.findByPk(id_pedido, { transaction: t, lock: t.LOCK.UPDATE });
    // Se vuelven a leer con el pedido ya bloqueado: caja pudo registrar un pago mientras se
    // esperaba el bloqueo, y todo se valida ANTES de cancelar nada en Stripe (es irreversible).
    const pendientes = await db.pago.findAll({ where: { id_pedido, estado_pago: "PENDIENTE" }, order: [["id_pago", "ASC"]], transaction: t, lock: t.LOCK.UPDATE });
    const gracia = new Date(Date.now() - MINUTOS_GRACIA * 60000);
    const saltar = !pedido || !estaVencido(pedido)
      || (await totalPagado(id_pedido, t)) > 0
      || pendientes.some((p) => p.metodo_pago !== "STRIPE")
      || pendientes.some((p) => p.metodo_pago === "STRIPE" && p.fecha_pago && new Date(p.fecha_pago) > gracia);
    if (saltar) { await t.rollback(); return "omitido"; }

    for (const pago of pendientes) {
      if (pagosStripe.esPagoStripeReal(pago)) {
        const estado = await pagosStripe.cancelarIntentoStripe(pago); // puede lanzar (Stripe caído): se reintenta en la próxima revisión
        if (estado === "cobrado") {
          await registrarCobroExitoso(pago, t);
          await t.commit();
          return "cobrado";
        }
        if (estado === "procesando") { await t.rollback(); return "omitido"; }
      }
      await pagosStripe.anularPagoPendiente(pago, "el pedido venció sin pago", t);
    }

    const motivo = `por vencimiento: sin pago en ${HORAS_PEDIDO_PENDIENTE} h`;
    await cancelarPedido(pedido, { id_empleado: null, motivo }, t);
    await registrarAuditoria({
      id_empleado: null, accion: "PEDIDO_ESTADO_ACTUALIZADO", tabla_afectada: "Pedido", registro_afectado_id: pedido.id_pedido,
      detalles: `Pedido #${pedido.id_pedido} cambiado de PENDIENTE a CANCELADO ${motivo}; el stock volvió a estar disponible.`
    }, t);
    t.afterCommit(() => require("./notificaciones").pedidoCancelado(pedido.id_pedido, `porque no recibimos el pago dentro de ${HORAS_PEDIDO_PENDIENTE} horas`));
    await t.commit();
    resultado = "cancelado";
  } catch (error) {
    await t.rollback().catch(() => {});
    console.warn(`[vencimientos] Pedido #${id_pedido}: ${error.message}`);
  }
  return resultado;
}

// Una revisión completa: busca los pedidos vencidos y los procesa uno por uno (cada uno en su
// propia transacción; un error en uno no detiene a los demás).
async function vencerPedidos() {
  const resumen = { cancelados: 0, cobrados: 0, omitidos: 0 };
  if (HORAS_PEDIDO_PENDIENTE <= 0) return resumen;
  const limite = new Date(Date.now() - plazoMs());
  // Solo los que de verdad pueden vencer: sin pagos completados ni pagos de caja por confirmar
  // (esos los resuelve caja). Si no, unos cuantos que siempre se omiten taparían a los demás.
  const { Op } = db.Sequelize;
  const candidatos = await db.pedido.findAll({
    attributes: ["id_pedido"],
    where: {
      estado: "PENDIENTE", fecha_pedido: { [Op.lte]: limite },
      [Op.and]: [db.sequelize.literal(`NOT EXISTS (SELECT 1 FROM "Pago" pg WHERE pg.id_pedido = "Pedido".id_pedido AND (pg.estado_pago = 'COMPLETADO' OR (pg.estado_pago = 'PENDIENTE' AND pg.metodo_pago <> 'STRIPE')))`)]
    },
    order: [["id_pedido", "ASC"]], limit: 200
  });
  for (const { id_pedido } of candidatos) {
    const r = await vencerPedido(id_pedido);
    resumen[r === "cancelado" ? "cancelados" : r === "cobrado" ? "cobrados" : "omitidos"]++;
  }
  if (resumen.cancelados || resumen.cobrados) console.log(`[vencimientos] ${resumen.cancelados} pedido(s) cancelado(s) por falta de pago, ${resumen.cobrados} con cobro tardío registrado.`);
  return resumen;
}

// Corre vencerPedidos con un candado de Postgres: si hay varias instancias, solo una revisa (la
// otra no espera: lo intentará en la próxima vuelta). Candado de transacción: funciona con pooler.
function revisarConCandado() {
  const { conCandado } = require("./migrador");
  const { reintentarPendientes } = require("./reembolsos");
  return conCandado(db, async () => {
    const pedidos = await vencerPedidos();
    // En la misma vuelta: reembolsos a tarjeta que Stripe dejó pendientes.
    const reembolsos = await reintentarPendientes().catch((e) => { console.warn(`[reembolsos] ${e.message}`); return null; });
    return { pedidos, reembolsos };
  }, { clave: CANDADO, intentar: true });
}

// Tareas periódicas del servidor (vencer pedidos y reintentar reembolsos pendientes).
let temporizador = null, enCurso = false;
function iniciarVencimientos() {
  if (temporizador) return;
  const revisar = async () => {
    if (enCurso) return;
    enCurso = true;
    try { await revisarConCandado(); } catch (error) { console.warn(`[vencimientos] ${error.message}`); } finally { enCurso = false; }
  };
  setTimeout(revisar, Math.min(5000, INTERVALO_MS)).unref();
  temporizador = setInterval(revisar, INTERVALO_MS);
  temporizador.unref();
}

module.exports = { HORAS_PEDIDO_PENDIENTE, MINUTOS_GRACIA, venceEl, estaVencido, vencerPedido, vencerPedidos, iniciarVencimientos };
