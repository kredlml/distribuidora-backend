const db = require("../models");
const Pago = db.pago;
const Pedido = db.pedido;
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); 

exports.create = async (req, res) => {
  
  const t = await db.sequelize.transaction();

  try {
    const { metodo_pago, monto, id_pedido } = req.body;

    if (!metodo_pago || !monto || !id_pedido) {
      throw new Error("Método de pago, monto e id_pedido son obligatorios.");
    }

    
    const pedido = await Pedido.findByPk(id_pedido, { transaction: t });
    if (!pedido) {
      throw new Error("El pedido no existe.");
    }

    let id_transaccion = null;
    let estado_inicial = 'PENDIENTE';

   
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
           // Aquí idealmente esperarías el webhook para pasarlo a COMPLETADO, 
           // pero para el flujo síncrono actual asumiremos PENDIENTE hasta el webhook.
        }
      } catch (stripeError) {
        throw new Error("Error en pasarela Stripe: " + stripeError.message);
      }
    }

    
    const nuevoPago = await Pago.create({
      metodo_pago: metodo_pago,
      monto: monto,
      estado_pago: estado_inicial,
      id_transaccion_externa: id_transaccion,
      id_pedido: id_pedido
    }, { transaction: t });

    
    if (estado_inicial === 'COMPLETADO') {
        await Pedido.update(
            { estado: 'PROCESADO' },
            { where: { id_pedido: id_pedido }, transaction: t }
        );
    }

    
    await t.commit();
    res.status(201).send({
      message: "Pago procesado y registrado con éxito.",
      pago: nuevoPago
    });

  } catch (error) {
    
    await t.rollback();
    res.status(error.message.includes("Stripe") ? 500 : 400).send({ message: error.message });
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