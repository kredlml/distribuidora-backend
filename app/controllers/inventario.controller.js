const db = require("../models");
const Inventario = db.inventario;

exports.create = async (req, res) => {
  try {
    // Validar las dos llaves foráneas y la cantidad
    if (!req.body.id_producto || !req.body.id_sucursal || req.body.cantidad_actual === undefined) {
      return res.status(400).send({ message: "El id_producto, id_sucursal y cantidad_actual son obligatorios." });
    }

    const nuevoInventario = {
      id_producto: req.body.id_producto,
      id_sucursal: req.body.id_sucursal,
      cantidad_actual: req.body.cantidad_actual,
      stock_minimo: req.body.stock_minimo || 0
    };

    const data = await Inventario.create(nuevoInventario);
    res.status(201).send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al registrar el Inventario." });
  }
};

exports.findAll = async (req, res) => {
  try {
    const data = await Inventario.findAll();
    res.send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al recuperar el inventario." });
  }
};