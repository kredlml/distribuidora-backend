const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require("../models");
const Pedido = db.pedido; 

exports.stripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET; 

  let event;

  try {
    
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error("⚠️ Error de firma del Webhook:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    console.log(`💰 ¡Éxito! Stripe confirma que el banco cobró: ${paymentIntent.id}`);
    
    try {
      
      await Pedido.update(
        { estado: 'PAGADO' }, 
        { where: { stripe_payment_id: paymentIntent.id } }
      );
      console.log("✅ Base de datos actualizada a PAGADO.");
    } catch (error) {
      console.error("Error actualizando la base de datos:", error);
    }
  } else if (event.type === 'payment_intent.payment_failed') {
    const paymentIntent = event.data.object;
    console.log(`❌ El cobro rebotó o la tarjeta fue declinada: ${paymentIntent.id}`);
    
  }

  
  res.status(200).send();
};