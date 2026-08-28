const db = require("../models");
const Pago = db.pago;

exports.create = async (req, res) => {
  try {
    if (!req.body.metodo_pago || !req.body.monto || !req.body.id_pedido) {
      return res.status(400).send({ message: "Método de pago, monto e id_pedido son obligatorios." });
    }

    const nuevoPago = {
      metodo_pago: req.body.metodo_pago, // STRIPE o PAYPAL
      monto: req.body.monto,
      estado_pago: req.body.estado_pago || 'PENDIENTE',
      id_transaccion_externa: req.body.id_transaccion_externa,
      id_pedido: req.body.id_pedido
    };

    const data = await Pago.create(nuevoPago);
    res.status(201).send(data);
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