const db = require("../models");
const Empleado = db.empleado;
const { PUESTOS_VALIDOS } = require("../middlewares/authJwt.js");

exports.create = async (req, res) => {
  try {
    req.body = req.body || {};
    if (!req.body.nombre || !req.body.apellido || !req.body.puesto || !req.body.fecha_contratacion || !req.body.id_sucursal) {
      return res.status(400).send({ message: "Faltan campos obligatorios (nombre, apellido, puesto, fecha_contratacion, id_sucursal)." });
    }
    const puesto = String(req.body.puesto).trim().toUpperCase();
    if (!PUESTOS_VALIDOS.includes(puesto)) {
      return res.status(400).send({ message: `El puesto debe ser uno de: ${PUESTOS_VALIDOS.join(", ")}.` });
    }
    const nuevoEmpleado = {
      nombre: req.body.nombre,
      apellido: req.body.apellido,
      puesto,
      telefono: req.body.telefono,
      email: req.body.email,
      fecha_contratacion: req.body.fecha_contratacion,
      id_sucursal: req.body.id_sucursal,
      activo: req.body.activo !== undefined ? req.body.activo : true
    };
    const data = await Empleado.create(nuevoEmpleado);
    const { password, ...sinPassword } = data.toJSON();
    res.status(201).send(sinPassword);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al crear el Empleado." });
  }
};

exports.findAll = async (req, res) => {
  try {
    // Nunca se exponen los hashes de contraseña.
    const data = await Empleado.findAll({ attributes: { exclude: ['password'] } });
    res.send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al recuperar los empleados." });
  }
};