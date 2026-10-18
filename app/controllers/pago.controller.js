const db = require("../models");
const Pago = db.pago;
const Pedido = db.pedido;
const { stripe, STRIPE_SIMULADO } = require("../config/stripe.config");
const { registrarAuditoria } = require("../utils/auditoria");
const { errorHttp, normalizarMonto, totalPagado, totalComprometido, procesarPedidoSiEstaPagado, registrarCobroExitoso } = require("../utils/facturacion");

exports.create = async (req, res) => {

  const t = await db.sequelize.transaction();

  try {
    const { metodo_pago, monto, id_pedido } = req.body || {};

    if (!metodo_pago || !monto || !id_pedido) {
      throw errorHttp(400, "Método de pago, monto e id_pedido son obligatorios.");
    }
    const montoNum = normalizarMonto(monto);


    const pedido = await Pedido.findByPk(id_pedido, { transaction: t, lock: t.LOCK.UPDATE });
    if (!pedido) {
      throw errorHttp(404, "El pedido no existe.");
    }

    // Solo se cobra lo que el pedido realmente debe: nada sobre pedidos ya pagados,
    // cancelados o sin productos, y nunca más que el saldo pendiente. Los pagos PENDIENTES
    // también descuentan saldo: si se confirman todos, no deben superar el total.
    if (pedido.estado !== 'PENDIENTE') {
      throw errorHttp(400, `Solo se pueden registrar pagos de pedidos PENDIENTES de pago (estado actual: ${pedido.estado}).`);
    }
    const total = Number(pedido.total);
    if (total <= 0) {
      throw errorHttp(400, "El pedido no tiene productos; no hay nada que cobrar.");
    }
    const saldo = Math.round((total - await totalComprometido(id_pedido, t)) * 100) / 100;
    if (montoNum > saldo) {
      throw errorHttp(400, `El monto no puede superar el saldo pendiente del pedido (${saldo.toFixed(2)}, descontando pagos completados y pendientes de confirmar).`);
    }

    let id_transaccion = null;
    let estado_inicial = 'PENDIENTE';


    if (metodo_pago === 'STRIPE') {
      try {
        if (STRIPE_SIMULADO) {
           id_transaccion = 'pi_simulado_' + Math.floor(Math.random() * 1000000);
           estado_inicial = 'COMPLETADO';
        } else {
           const paymentIntent = await stripe.paymentIntents.create({
             amount: Math.round(montoNum * 100),
             currency: 'gtq',
             payment_method_types: ['card'],
             metadata: { pedido_id: id_pedido }
           });
           id_transaccion = paymentIntent.id;

        }
      } catch (stripeError) {
        throw new Error("Error en pasarela Stripe: " + stripeError.message);
      }
    }


    const nuevoPago = await Pago.create({
      metodo_pago: metodo_pago,
      monto: montoNum,
      estado_pago: estado_inicial,
      id_transaccion_externa: id_transaccion,
      id_pedido: id_pedido
    }, { transaction: t });

    // Si con este pago el pedido queda cubierto, deja de estar PENDIENTE (pasa a PROCESADO).
    let pedidoActualizado = pedido;
    if (estado_inicial === 'COMPLETADO') {
      pedidoActualizado = await procesarPedidoSiEstaPagado(id_pedido, req.empleadoId, t);
    }


    await t.commit();
    res.status(201).send({
      message: "Pago procesado y registrado con éxito.",
      pago: nuevoPago,
      estado_pedido: pedidoActualizado.estado
    });

  } catch (error) {

    await t.rollback();
    res.status(error.status || (error.message.includes("Stripe") ? 500 : 400)).send({ message: error.message });
  }
};

// PUT /api/pagos/:id/confirmar — confirma un pago PENDIENTE (p.ej. PAYPAL verificado por
// el cajero). Un pago STRIPE solo se confirma si Stripe reporta el cobro como exitoso.
// Si los pagos completados cubren el total, el pedido pasa automáticamente a PROCESADO.
exports.confirmar = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const pago = await Pago.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!pago) {
      throw errorHttp(404, `No se encontró el pago con id=${req.params.id}.`);
    }
    if (pago.estado_pago !== 'PENDIENTE') {
      throw errorHttp(400, `Solo se pueden confirmar pagos PENDIENTES (estado actual: ${pago.estado_pago}).`);
    }

    const pedido = await Pedido.findByPk(pago.id_pedido, { transaction: t, lock: t.LOCK.UPDATE });
    if (!pedido || pedido.estado !== 'PENDIENTE') {
      throw errorHttp(400, `El pedido asociado ya no está PENDIENTE de pago (estado actual: ${pedido ? pedido.estado : 'inexistente'}).`);
    }
    const saldo = Math.round((Number(pedido.total) - await totalPagado(pedido.id_pedido, t)) * 100) / 100;
    if (Number(pago.monto) > saldo) {
      throw errorHttp(400, `El monto del pago (${Number(pago.monto).toFixed(2)}) supera el saldo pendiente del pedido (${saldo.toFixed(2)}).`);
    }

    if (pago.metodo_pago === 'STRIPE') {
      let paymentIntent;
      try {
        paymentIntent = await stripe.paymentIntents.retrieve(pago.id_transaccion_externa);
      } catch (stripeError) {
        throw errorHttp(502, "Error en pasarela Stripe: " + stripeError.message);
      }
      if (paymentIntent.status !== 'succeeded') {
        throw errorHttp(400, `Stripe aún no confirma el cobro (estado: ${paymentIntent.status}).`);
      }
    }

    pago.estado_pago = 'COMPLETADO';
    await pago.save({ transaction: t });

    await registrarAuditoria({
      id_empleado: req.empleadoId,
      accion: 'PAGO_CONFIRMADO',
      tabla_afectada: 'Pago',
      registro_afectado_id: pago.id_pago,
      detalles: `Pago #${pago.id_pago} (${pago.metodo_pago}) de ${Number(pago.monto).toFixed(2)} confirmado para el pedido #${pago.id_pedido}.`
    }, t);

    const pedidoActualizado = await procesarPedidoSiEstaPagado(pago.id_pedido, req.empleadoId, t);

    await t.commit();
    res.status(200).send({
      message: `Pago confirmado. El pedido está en estado ${pedidoActualizado.estado}.`,
      pago,
      estado_pedido: pedidoActualizado.estado
    });
  } catch (error) {
    await t.rollback();
    res.status(error.status || 500).send({ message: error.message || "Error al confirmar el pago." });
  }
};

// PUT /api/pagos/:id/anular — anula un pago PENDIENTE que no se va a completar (cliente
// desistió, tarjeta rechazada...). Libera el saldo del pedido y permite cancelarlo.
// En STRIPE se cancela también el PaymentIntent para que ya no pueda cobrarse.
exports.anular = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const pago = await Pago.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!pago) {
      throw errorHttp(404, `No se encontró el pago con id=${req.params.id}.`);
    }
    if (pago.estado_pago !== 'PENDIENTE') {
      throw errorHttp(400, `Solo se pueden anular pagos PENDIENTES (estado actual: ${pago.estado_pago}).`);
    }

    if (pago.metodo_pago === 'STRIPE' && pago.id_transaccion_externa && !pago.id_transaccion_externa.startsWith('pi_simulado_')) {
      try {
        await stripe.paymentIntents.cancel(pago.id_transaccion_externa);
      } catch (stripeError) {
        // Stripe no dejó cancelarlo: se consulta su estado real antes de decidir.
        let pi;
        try {
          pi = await stripe.paymentIntents.retrieve(pago.id_transaccion_externa);
        } catch (e) {
          throw errorHttp(502, "No se pudo consultar el pago en Stripe: " + e.message);
        }
        if (pi.status === 'succeeded') {
          // Ya se cobró: se registra el pago en lugar de anularlo.
          await registrarCobroExitoso(pago, t);
          await t.commit();
          return res.status(409).send({ message: "Stripe ya cobró este pago; se registró como COMPLETADO en lugar de anularlo." });
        }
        if (pi.status !== 'canceled') {
          throw errorHttp(400, "Stripe no permitió cancelar el cobro: " + stripeError.message);
        }
        // Ya estaba cancelado en Stripe: se anula también aquí.
      }
    }

    pago.estado_pago = 'FALLIDO';
    await pago.save({ transaction: t });

    await registrarAuditoria({
      id_empleado: req.empleadoId,
      accion: 'PAGO_ANULADO',
      tabla_afectada: 'Pago',
      registro_afectado_id: pago.id_pago,
      detalles: `Pago #${pago.id_pago} (${pago.metodo_pago}) de ${Number(pago.monto).toFixed(2)} anulado para el pedido #${pago.id_pedido}.`
    }, t);

    await t.commit();
    res.status(200).send({ message: "Pago anulado.", pago });
  } catch (error) {
    await t.rollback();
    res.status(error.status || 500).send({ message: error.message || "Error al anular el pago." });
  }
};

exports.findAll = async (req, res) => {

  try {

    const data = await Pago.findAll();

    res.send(data);

  } catch (error) {

    res.status(500).send({ message: error.message || "Error al recuperar los pagos." });

  }

};
