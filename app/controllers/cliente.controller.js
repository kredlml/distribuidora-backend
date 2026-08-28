const db = require("../models");
const Cliente = db.cliente;

exports.create = async (req, res) => {
  try {
    if (!req.body.nombre || !req.body.apellido) {
      return res.status(400).send({ message: "El nombre y apellido son obligatorios." });
    }
    const nuevoCliente = {
      nombre: req.body.nombre,
      apellido: req.body.apellido,
      telefono: req.body.telefono,
      email: req.body.email,
      direccion: req.body.direccion,
      activo: req.body.activo !== undefined ? req.body.activo : true
    };
    const data = await Cliente.create(nuevoCliente);
    res.status(201).send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al crear el Cliente." });
  }
};

exports.findAll = async (req, res) => {
  try {
    const data = await Cliente.findAll();
    res.send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al recuperar los clientes." });
  }
};