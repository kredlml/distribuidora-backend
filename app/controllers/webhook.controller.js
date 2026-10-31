const { stripe } = require("../config/stripe.config");
const db = require("../models");
const Pago = db.pago;
const { registrarAuditoria } = require("../utils/auditoria");
const { registrarCobroExitoso } = require("../utils/facturacion");
const { procesarEnStripe } = require("../utils/reembolsos");

exports.stripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];

  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // req.body llega crudo (Buffer) porque esta ruta se registra antes de bodyParser.json en server.js.
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error("Error de firma del Webhook:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Reembolsos: Stripe avisa cuando uno que quedó "pending" se completa o falla. Se busca por su
  // id (re_…) o por metadata.id_reembolso y se vuelve a consultar en Stripe (fuente de verdad).
  if (['refund.updated', 'refund.failed', 'charge.refund.updated', 'refund.created'].includes(event.type)) {
    const re = event.data.object;
    try {
      const idLocal = re.metadata && /^\d+$/.test(String(re.metadata.id_reembolso || "")) ? Number(re.metadata.id_reembolso) : null;
      const r = await db.reembolso.findOne({ where: idLocal ? { id_reembolso: idLocal } : { id_transaccion_externa: re.id } });
      if (r && r.metodo === 'STRIPE' && r.estado === 'PENDIENTE') await procesarEnStripe(r.id_reembolso, null);
    } catch (error) {
      console.error("Webhook de reembolso:", error.message);
      return res.status(500).send();
    }
    return res.status(200).send();
  }

  const EVENTOS = ['payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled'];
  if (EVENTOS.includes(event.type)) {
    const paymentIntent = event.data.object;
    const t = await db.sequelize.transaction();
    try {
      // El PaymentIntent se guardó en Pago.id_transaccion_externa al registrar el pago.
      const pago = await Pago.findOne({
        where: { id_transaccion_externa: paymentIntent.id },
        transaction: t,
        lock: t.LOCK.UPDATE
      });

      if (!pago) {
        console.warn(`Webhook: no hay un Pago registrado para ${paymentIntent.id}.`);
      } else if (event.type === 'payment_intent.succeeded') {
        console.log(`¡Éxito! Stripe confirma que el banco cobró: ${paymentIntent.id}`);
        // También FALLIDO: un pago anterior a este cambio pudo quedar así tras un intento rechazado.
        if (pago.estado_pago === 'PENDIENTE' || pago.estado_pago === 'FALLIDO') {
          await registrarCobroExitoso(pago, t);
        }
      } else if (event.type === 'payment_intent.payment_failed') {
        // No es definitivo: el cliente puede reintentar con otra tarjeta sobre el mismo
        // PaymentIntent, así que el pago sigue PENDIENTE y solo se deja constancia.
        console.log(`El cobro rebotó o la tarjeta fue declinada: ${paymentIntent.id}`);
        await registrarAuditoria({
          id_empleado: null,
          accion: 'PAGO_INTENTO_FALLIDO',
          tabla_afectada: 'Pago',
          registro_afectado_id: pago.id_pago,
          detalles: `Stripe rechazó un intento de cobro del pago #${pago.id_pago} (pedido #${pago.id_pedido}); el pago sigue PENDIENTE.`
        }, t);
      } else if (pago.estado_pago === 'PENDIENTE') {
        // payment_intent.canceled: ese PaymentIntent ya no podrá cobrarse.
        pago.estado_pago = 'FALLIDO';
        await pago.save({ transaction: t });
      }

      await t.commit();
    } catch (error) {
      await t.rollback();
      console.error("Error actualizando la base de datos:", error);
      // 500 para que Stripe reintente la notificación más tarde.
      return res.status(500).send();
    }
  }


  res.status(200).send();
};
