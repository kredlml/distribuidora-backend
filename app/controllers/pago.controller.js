const db = require("../models");
const Pago = db.pago;
const Pedido = db.pedido;

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); 

exports.create = async (req, res) => {
  try {
    const { metodo_pago, monto, id_pedido } = req.body;

    if (!metodo_pago || !monto || !id_pedido) {
      return res.status(400).send({ message: "Método de pago, monto e id_pedido son obligatorios." });
    }

    // 1. Validar que el pedido existe
    const pedido = await Pedido.findByPk(id_pedido);
    if (!pedido) {
      return res.status(404).send({ message: "El pedido no existe." });
    }

    let id_transaccion = null;
    let estado_inicial = 'PENDIENTE';

    // 2. Lógica de integración con Stripe
    if (metodo_pago === 'STRIPE') {
      try {
        
        if (process.env.STRIPE_SECRET_KEY === 'sk_test_clave_de_prueba_universidad') {
           id_transaccion = 'pi_simulado_' + Math.floor(Math.random() * 1000000);
           estado_inicial = 'COMPLETADO'; 
        } else {
           
           const paymentIntent = await stripe.paymentIntents.create({
             amount: Math.round(monto * 100), 
             currency: 'gtq', 
             payment_method_types: ['card'],
             metadata: { pedido_id: id_pedido }
           });
           id_transaccion = paymentIntent.id;
        }
      } catch (stripeError) {
        return res.status(500).send({ message: "Error en pasarela Stripe: " + stripeError.message });
      }
    }

    // 3. Guardar el registro en Neon
    const nuevoPago = await Pago.create({
      metodo_pago: metodo_pago,
      monto: monto,
      estado_pago: estado_inicial,
      id_transaccion_externa: id_transaccion,
      id_pedido: id_pedido
    });

    res.status(201).send({
      message: "Pago procesado y registrado con éxito.",
      pago: nuevoPago
    });

  } catch (error) {
    res.status(500).send({ message: error.message || "Error al registrar el Pago." });
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