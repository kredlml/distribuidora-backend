const db = require("../models");
const { stripe } = require("../config/stripe.config");
const { registrarAuditoria } = require("./auditoria");
const { errorHttp } = require("./facturacion");

// Ayudas para los pagos con tarjeta en línea (Stripe) que comparten la tienda y el vencimiento
// automático de pedidos.

const esPagoStripeReal = (pago) => pago.metodo_pago === 'STRIPE' && pago.id_transaccion_externa && !pago.id_transaccion_externa.startsWith('pi_simulado_');
const centavos = (monto) => Math.round(Number(monto) * 100);

// Marca FALLIDO un pago PENDIENTE solo si sigue PENDIENTE (lo pudo completar el webhook).
async function anularPagoPendiente(pago, motivo, t) {
  const [n] = await db.pago.update({ estado_pago: 'FALLIDO' }, { where: { id_pago: pago.id_pago, estado_pago: 'PENDIENTE' }, transaction: t });
  if (n) {
    await registrarAuditoria({
      id_empleado: null,
      accion: 'PAGO_ANULADO',
      tabla_afectada: 'Pago',
      registro_afectado_id: pago.id_pago,
      detalles: `Pago #${pago.id_pago} (STRIPE) de ${Number(pago.monto).toFixed(2)} anulado: ${motivo}.`
    }, t);
  }
}

// Cancela en Stripe el PaymentIntent de un pago. Si Stripe no lo permite se consulta su estado
// real: 'cancelado' (ya lo estaba), 'cobrado' (succeeded) o 'procesando'.
async function cancelarIntentoStripe(pago) {
  try {
    await stripe.paymentIntents.cancel(pago.id_transaccion_externa);
    return 'cancelado';
  } catch (errorCancelar) {
    let pi;
    try {
      pi = await stripe.paymentIntents.retrieve(pago.id_transaccion_externa);
    } catch (stripeError) {
      throw errorHttp(502, "No se pudo consultar el pago en Stripe: " + stripeError.message);
    }
    if (pi.status === 'canceled') return 'cancelado';
    if (pi.status === 'succeeded') return 'cobrado';
    if (pi.status === 'processing') return 'procesando';
    throw errorHttp(502, "Stripe no permitió cancelar el cobro: " + errorCancelar.message);
  }
}

module.exports = { esPagoStripeReal, centavos, anularPagoPendiente, cancelarIntentoStripe };
