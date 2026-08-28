const db = require("../models");
const Pedido = db.pedido;

exports.create = async (req, res) => {
  try {
    if (!req.body.id_cliente || !req.body.id_sucursal) {
      return res.status(400).send({ message: "El id_cliente y id_sucursal son obligatorios." });
    }

    const nuevoPedido = {
      estado: req.body.estado || 'PENDIENTE',
      total: req.body.total || 0, // Inicialmente 0, se suma con los detalles
      id_cliente: req.body.id_cliente,
      id_sucursal: req.body.id_sucursal,
      id_empleado: req.body.id_empleado // Opcional, quién lo atendió
    };

    const data = await Pedido.create(nuevoPedido);
    res.status(201).send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al crear el Pedido." });
  }
};

exports.findAll = async (req, res) => {
  try {
    const data = await Pedido.findAll();
    res.send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al recuperar los pedidos." });
  }
};