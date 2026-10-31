const db = require("../models");
const { stripe, STRIPE_SIMULADO } = require("../config/stripe.config");
const { registrarAuditoria } = require("./auditoria");
const { Op } = db.Sequelize;

// Reembolsos de dinero por devoluciones. El monto se calcula con lo que la clienta realmente pagó
// por cada prenda (precio de la línea con el descuento del pedido prorrateado; el envío no se
// devuelve) y se reparte: primero a la tarjeta con la que pagó en línea (Stripe, automático) y el
// resto en caja con el método presencial del pedido (queda PENDIENTE hasta que caja lo entrega).

const r2 = (n) => Math.round(Number(n) * 100) / 100;

// Proporción de lo cobrado por las prendas después del descuento del pedido (1 = sin descuento).
async function factorDescuento(pedido, t) {
  const lineas = Number(await db.detalle_pedido.sum("subtotal", { where: { id_pedido: pedido.id_pedido }, transaction: t }) || 0);
  const descuento = Number(pedido.descuento || 0);
  return lineas > 0 ? Math.min(1, Math.max(0, (lineas - descuento) / lineas)) : 1;
}

// Monto a devolver por una devolución ya aceptada:
//  - DEVOLUCION: lo pagado por las prendas devueltas;
//  - CAMBIO_TALLA / CAMBIO_VARIANTE: la diferencia si la variante nueva cuesta menos (si cuesta lo
//    mismo, nada). Nunca se cobra una diferencia: los cambios solo admiten variantes de igual o menor precio.
async function montoDeDevolucion(devolucion, pedido, t) {
  const detalles = await db.detalle_devolucion.findAll({
    where: { id_devolucion: devolucion.id_devolucion },
    include: [
      { model: db.detalle_pedido, attributes: ["precio_unitario"] },
      { model: db.producto, as: "ProductoNuevo", attributes: ["precio_unitario"] }
    ],
    transaction: t
  });
  let bruto = 0;
  for (const d of detalles) {
    const pagado = Number(d.DetallePedido.precio_unitario);
    if (devolucion.tipo === "DEVOLUCION") bruto += pagado * d.cantidad;
    else if (d.id_producto_nuevo) {
      // El precio acordado al pedir el cambio (las solicitudes antiguas sin él usan el del catálogo).
      const nuevo = d.precio_unitario_nuevo != null ? Number(d.precio_unitario_nuevo) : d.ProductoNuevo ? Number(d.ProductoNuevo.precio_unitario) : pagado;
      bruto += Math.max(0, pagado - nuevo) * d.cantidad;
    }
  }
  return r2(bruto * await factorDescuento(pedido, t));
}

const esSimulado = (pago) => STRIPE_SIMULADO || !pago.id_transaccion_externa || pago.id_transaccion_externa.startsWith("pi_simulado_");

// Crea los reembolsos (PENDIENTE) de una devolución dentro de la transacción. Nunca devuelve más de
// lo cobrado al pedido menos lo ya reembolsado. Devuelve los reembolsos creados.
async function crearReembolsosDeDevolucion({ devolucion, pedido, id_empleado }, t) {
  let monto = await montoDeDevolucion(devolucion, pedido, t);
  if (monto <= 0) return [];

  const pagos = await db.pago.findAll({ where: { id_pedido: pedido.id_pedido, estado_pago: "COMPLETADO" }, order: [["id_pago", "DESC"]], transaction: t });
  // Solo cuenta lo devuelto de pagos que siguen COMPLETADO (un cobro de Stripe que no correspondía
  // ya quedó REEMBOLSADO y fuera de "cobrado"; restarlo otra vez dejaría a la clienta sin su reembolso).
  const idsCobrados = new Set(pagos.map((p) => p.id_pago));
  const previos = (await db.reembolso.findAll({ where: { id_pedido: pedido.id_pedido, estado: ["PENDIENTE", "COMPLETADO"] }, transaction: t }))
    .filter((r) => r.id_devolucion !== null || (r.id_pago && idsCobrados.has(r.id_pago)));
  const cobrado = pagos.reduce((s, p) => s + Number(p.monto), 0);
  const yaDevuelto = previos.reduce((s, r) => s + Number(r.monto), 0);
  monto = r2(Math.min(monto, cobrado - yaDevuelto));
  if (monto <= 0) return [];

  const creados = [];
  // 1) A la tarjeta en línea, pago por pago, hasta lo que cada uno tiene sin reembolsar.
  for (const pago of pagos.filter((p) => p.metodo_pago === "STRIPE")) {
    if (monto <= 0) break;
    const devueltoDeEste = previos.filter((r) => r.id_pago === pago.id_pago).reduce((s, r) => s + Number(r.monto), 0);
    const parte = r2(Math.min(monto, Number(pago.monto) - devueltoDeEste));
    if (parte <= 0) continue;
    creados.push(await db.reembolso.create({
      id_devolucion: devolucion.id_devolucion, id_pedido: pedido.id_pedido, id_pago: pago.id_pago,
      metodo: "STRIPE", monto: parte, estado: "PENDIENTE", observacion: "Reembolso a la tarjeta con la que pagó en línea."
    }, { transaction: t }));
    monto = r2(monto - parte);
  }
  // 2) El resto, en caja, por cada método presencial (el más usado primero) hasta lo cobrado con él
  //    menos lo ya devuelto por ese método: un POS no puede revertir más de lo que cobró.
  const disponible = {};
  pagos.filter((p) => p.metodo_pago !== "STRIPE").forEach((p) => { disponible[p.metodo_pago] = (disponible[p.metodo_pago] || 0) + Number(p.monto); });
  // (los que tienen id_pago son de un pago en línea, aunque caja los haya entregado en efectivo)
  previos.filter((r) => !r.id_pago).forEach((r) => { if (disponible[r.metodo] !== undefined) disponible[r.metodo] -= Number(r.monto); });
  const observacion = (m) => (m === "TARJETA" ? "Reversión en el terminal POS de la tienda." : m === "PAYPAL" ? "Reembolso por PayPal." : "Entregar el efectivo en caja.");
  for (const metodo of Object.keys(disponible).sort((a, b) => disponible[b] - disponible[a])) {
    if (monto <= 0) break;
    const parte = r2(Math.min(monto, disponible[metodo]));
    if (parte <= 0) continue;
    creados.push(await db.reembolso.create({
      id_devolucion: devolucion.id_devolucion, id_pedido: pedido.id_pedido, metodo, monto: parte, estado: "PENDIENTE", observacion: observacion(metodo)
    }, { transaction: t }));
    monto = r2(monto - parte);
  }
  // Lo que no cubre ningún pago (no debería pasar por el tope de arriba) se entrega en efectivo.
  if (monto > 0) {
    creados.push(await db.reembolso.create({
      id_devolucion: devolucion.id_devolucion, id_pedido: pedido.id_pedido, metodo: "EFECTIVO", monto, estado: "PENDIENTE", observacion: observacion("EFECTIVO")
    }, { transaction: t }));
  }
  if (!creados.length) return [];
  await registrarAuditoria({
    id_empleado, accion: "REEMBOLSO_CREADO", tabla_afectada: "Reembolso", registro_afectado_id: creados[0].id_reembolso,
    detalles: `Devolución #${devolucion.id_devolucion}: reembolso de ${r2(creados.reduce((s, r) => s + Number(r.monto), 0)).toFixed(2)} (${creados.map((r) => `${r.metodo} ${Number(r.monto).toFixed(2)}`).join(", ")}).`.slice(0, 255)
  }, t);
  return creados;
}

const estadoDeRefund = (re) => (re.status === "succeeded" ? "COMPLETADO" : ["failed", "canceled"].includes(re.status) ? "FALLIDO" : "PENDIENTE");
// Errores de Stripe que no se arreglan reintentando (cargo ya devuelto desde el panel de Stripe,
// en disputa, monto mayor a lo que queda, PaymentIntent inválido): el reembolso pasa a FALLIDO y
// caja lo entrega en efectivo. La red, 409, 429, 5xx o una clave mal configurada sí se reintentan.
const esErrorDefinitivo = (e) => [400, 402, 404].includes(e && e.statusCode) && e.type !== "StripeIdempotencyError";
const RESERVA_MS = 2 * 60 * 1000;

// Ejecuta en Stripe un reembolso STRIPE PENDIENTE (fuera de cualquier transacción). Nunca lanza y
// devuelve la fila actualizada. Contra dobles reembolsos:
//  - reserva la fila (procesando_desde) para que dos reintentos simultáneos no vayan a la vez;
//  - si no se guardó el id de Stripe (respuesta perdida, caída), antes de crear otro busca en Stripe
//    uno ya hecho con metadata.id_reembolso (la clave de idempotencia de Stripe dura solo 24 h);
//  - escribe el resultado solo si la fila sigue PENDIENTE (nunca pisa algo resuelto por otro).
// Los avisos a la clienta (devuelto / rechazado) salen desde aquí, una sola vez.
async function procesarEnStripe(idReembolso, idEmpleado) {
  try {
    const ahora = new Date();
    const [reservada] = await db.reembolso.update({ procesando_desde: ahora }, {
      where: {
        id_reembolso: idReembolso, metodo: "STRIPE", estado: "PENDIENTE",
        [Op.or]: [{ procesando_desde: null }, { procesando_desde: { [Op.lt]: new Date(ahora.getTime() - RESERVA_MS) } }]
      }
    });
    const r = await db.reembolso.findByPk(idReembolso);
    if (!reservada) return r; // ya resuelto, no es de Stripe o lo está procesando otra petición
    const pago = await db.pago.findByPk(r.id_pago);

    let cambios;
    try {
      let re;
      if (!pago || esSimulado(pago)) {
        re = { id: `re_simulado_${r.id_reembolso}`, status: "succeeded" };
      } else if (r.id_transaccion_externa) {
        re = await stripe.refunds.retrieve(r.id_transaccion_externa); // ya se pidió: solo se consulta
      } else {
        const previos = await stripe.refunds.list({ payment_intent: pago.id_transaccion_externa, limit: 100 });
        re = (previos.data || []).find((x) => x.metadata && x.metadata.id_reembolso === String(r.id_reembolso));
        if (!re) {
          re = await stripe.refunds.create(
            { payment_intent: pago.id_transaccion_externa, amount: Math.round(Number(r.monto) * 100), metadata: { id_reembolso: String(r.id_reembolso), id_pedido: String(r.id_pedido) } },
            { idempotencyKey: `reembolso-${r.id_reembolso}` }
          );
        }
      }
      const estado = estadoDeRefund(re);
      cambios = { id_transaccion_externa: re.id, estado, fecha_completado: estado === "COMPLETADO" ? new Date() : null,
        observacion: estado === "FALLIDO" ? "Stripe no pudo devolverlo a la tarjeta: entregar en efectivo en caja." : r.observacion };
    } catch (error) {
      const definitivo = esErrorDefinitivo(error);
      console.warn(`[reembolsos] Stripe no procesó el reembolso #${r.id_reembolso}: ${error.message}`);
      cambios = definitivo
        ? { estado: "FALLIDO", observacion: `Stripe lo rechazó (${error.message}); entregar en efectivo en caja.`.slice(0, 255) }
        : { observacion: `Stripe: ${error.message}`.slice(0, 255) };
    }
    if (idEmpleado) cambios.id_empleado = idEmpleado;
    const [escrita] = await db.reembolso.update({ ...cambios, procesando_desde: null }, { where: { id_reembolso: r.id_reembolso, metodo: "STRIPE", estado: "PENDIENTE" } });

    if (escrita && cambios.estado && cambios.estado !== "PENDIENTE") {
      await registrarAuditoria({
        id_empleado: idEmpleado || null, accion: `REEMBOLSO_${cambios.estado}`, tabla_afectada: "Reembolso", registro_afectado_id: r.id_reembolso,
        detalles: `Reembolso #${r.id_reembolso} de ${Number(r.monto).toFixed(2)} a la tarjeta${cambios.id_transaccion_externa ? ` (Stripe ${cambios.id_transaccion_externa})` : ""}: ${cambios.estado}.`
      }).catch((e) => console.warn(`[reembolsos] auditoría: ${e.message}`));
      const notificaciones = require("./notificaciones");
      if (cambios.estado === "COMPLETADO") notificaciones.reembolsoCompletado(r.id_reembolso);
      else notificaciones.reembolsoFallido(r.id_reembolso);
    }
    return await db.reembolso.findByPk(idReembolso);
  } catch (error) {
    console.warn(`[reembolsos] Error al procesar el reembolso #${idReembolso}: ${error.message}`);
    return db.reembolso.findByPk(idReembolso).catch(() => null);
  }
}

// Devuelve completo un cobro de Stripe que no corresponde (pedido cancelado/vencido o ya pagado):
// el pago (bloqueado por quien llama) queda REEMBOLSADO para que no cuente como pagado, se crea el
// reembolso STRIPE y, al confirmar la transacción, se pide a Stripe y se avisa a la clienta.
async function reembolsarPagoStripe(pago, motivo, t) {
  const yaHay = await db.reembolso.count({ where: { id_pago: pago.id_pago, id_devolucion: null, estado: ["PENDIENTE", "COMPLETADO"] }, transaction: t });
  if (yaHay) return null;
  pago.estado_pago = "REEMBOLSADO";
  await pago.save({ transaction: t });
  const r = await db.reembolso.create({
    id_pedido: pago.id_pedido, id_pago: pago.id_pago, metodo: "STRIPE", monto: pago.monto, estado: "PENDIENTE", observacion: String(motivo || "").slice(0, 255) || null
  }, { transaction: t });
  await registrarAuditoria({
    id_empleado: null, accion: "REEMBOLSO_CREADO", tabla_afectada: "Reembolso", registro_afectado_id: r.id_reembolso,
    detalles: `Cobro de Stripe #${pago.id_pago} de ${Number(pago.monto).toFixed(2)} que no corresponde al pedido #${pago.id_pedido}: se devuelve a la tarjeta.`
  }, t);
  t.afterCommit(() => procesarEnStripe(r.id_reembolso, null));
  return r;
}

// Revisión periódica: los reembolsos a tarjeta que siguen PENDIENTES (Stripe no respondió o los
// dejó "pending") se vuelven a consultar/pedir solos, sin esperar a que caja pulse «Reintentar».
async function reintentarPendientes({ minutos = 5, maximo = 50 } = {}) {
  const pendientes = await db.reembolso.findAll({
    attributes: ["id_reembolso"],
    where: { metodo: "STRIPE", estado: "PENDIENTE", fecha_creacion: { [Op.lt]: new Date(Date.now() - minutos * 60000) } },
    order: [["id_reembolso", "ASC"]], limit: maximo
  });
  let resueltos = 0;
  for (const { id_reembolso } of pendientes) {
    const final = await procesarEnStripe(id_reembolso, null);
    if (final && final.estado !== "PENDIENTE") resueltos++;
  }
  if (resueltos) console.log(`[reembolsos] ${resueltos} reembolso(s) a tarjeta resueltos en la revisión periódica.`);
  return { revisados: pendientes.length, resueltos };
}

module.exports = { montoDeDevolucion, crearReembolsosDeDevolucion, procesarEnStripe, reembolsarPagoStripe, reintentarPendientes, factorDescuento };
