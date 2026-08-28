const db = require("../models");
const Proveedor = db.proveedor;

exports.create = async (req, res) => {
  try {
    if (!req.body.nombre_empresa) {
      return res.status(400).send({ message: "El nombre de la empresa es obligatorio." });
    }
    const nuevoProveedor = {
      nombre_empresa: req.body.nombre_empresa,
      nombre_contacto: req.body.nombre_contacto,
      telefono: req.body.telefono,
      email: req.body.email,
      direccion: req.body.direccion,
      activo: req.body.activo !== undefined ? req.body.activo : true
    };
    const data = await Proveedor.create(nuevoProveedor);
    res.status(201).send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al crear el Proveedor." });
  }
};

exports.findAll = async (req, res) => {
  try {
    const data = await Proveedor.findAll();
    res.send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al recuperar los proveedores." });
  }
};