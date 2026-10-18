// Cliente único de Stripe para todo el backend.
// STRIPE_API_HOST/PORT/PROTOCOL son opcionales: permiten apuntar a un servidor de pruebas
// (p.ej. stripe-mock) sin tocar código. En uso normal se usa la API real de Stripe.
const opciones = {};
if (process.env.STRIPE_API_HOST) {
  opciones.host = process.env.STRIPE_API_HOST;
  if (process.env.STRIPE_API_PORT) opciones.port = Number(process.env.STRIPE_API_PORT);
  if (process.env.STRIPE_API_PROTOCOL) opciones.protocol = process.env.STRIPE_API_PROTOCOL;
}

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, opciones);

// Con esta clave el backend simula los cobros (pago COMPLETADO al instante, sin llamar a Stripe).
const STRIPE_SIMULADO = process.env.STRIPE_SECRET_KEY === 'sk_test_clave_de_prueba_universidad';

module.exports = { stripe, STRIPE_SIMULADO };
