const db = require("../models");
const Empleado = db.empleado;

exports.create = async (req, res) => {
  try {
    if (!req.body.nombre || !req.body.apellido || !req.body.puesto || !req.body.fecha_contratacion || !req.body.id_sucursal) {
      return res.status(400).send({ message: "Faltan campos obligatorios (nombre, apellido, puesto, fecha_contratacion, id_sucursal)." });
    }
    const nuevoEmpleado = {
      nombre: req.body.nombre,
      apellido: req.body.apellido,
      puesto: req.body.puesto,
      telefono: req.body.telefono,
      email: req.body.email,
      fecha_contratacion: req.body.fecha_contratacion,
      id_sucursal: req.body.id_sucursal,
      activo: req.body.activo !== undefined ? req.body.activo : true
    };
    const data = await Empleado.create(nuevoEmpleado);
    res.status(201).send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al crear el Empleado." });
  }
};

exports.findAll = async (req, res) => {
  try {
    const data = await Empleado.findAll();
    res.send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al recuperar los empleados." });
  }
};