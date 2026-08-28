const db = require("../models");
const DetallePedido = db.detalle_pedido;

exports.create = async (req, res) => {
  try {
    if (!req.body.cantidad || !req.body.precio_unitario || !req.body.id_pedido || !req.body.id_producto) {
      return res.status(400).send({ message: "Cantidad, precio, id_pedido e id_producto son obligatorios." });
    }

    // Calculamos el subtotal automáticamente
    const subtotalCalc = req.body.cantidad * req.body.precio_unitario;

    const nuevoDetalle = {
      cantidad: req.body.cantidad,
      precio_unitario: req.body.precio_unitario,
      subtotal: subtotalCalc,
      id_pedido: req.body.id_pedido,
      id_producto: req.body.id_producto
    };

    const data = await DetallePedido.create(nuevoDetalle);
    res.status(201).send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al agregar el detalle del pedido." });
  }
};

exports.findAll = async (req, res) => {
  try {
    const data = await DetallePedido.findAll();
    res.send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al recuperar los detalles." });
  }
};