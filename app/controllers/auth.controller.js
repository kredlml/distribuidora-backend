const db = require("../models");
const Empleado = db.empleado;
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");


exports.registro = async (req, res) => {
  try {
    if (!req.body.password) {
      return res.status(400).send({ message: "¡La contraseña es obligatoria!" });
    }

    const nuevoEmpleado = await Empleado.create({
      nombre: req.body.nombre,
      apellido: req.body.apellido,
      puesto: req.body.puesto,
      email: req.body.email,
      password: bcrypt.hashSync(req.body.password, 8),
      id_sucursal: req.body.id_sucursal 
    });
    
    res.status(201).send({ message: "Empleado registrado exitosamente." });
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
};


exports.login = async (req, res) => {
  try {
    const empleado = await Empleado.findOne({ where: { email: req.body.email } });

    if (!empleado) {
      return res.status(404).send({ message: "Empleado no encontrado." });
    }

    const passwordValido = bcrypt.compareSync(req.body.password, empleado.password);

    if (!passwordValido) {
      return res.status(401).send({ token: null, message: "Contraseña incorrecta." });
    }

    
    const token = jwt.sign(
      { 
        id: empleado.id_empleado, 
        id_sucursal: empleado.id_sucursal 
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: 86400 } // 24 horas
    );

    res.status(200).send({
      id: empleado.id_empleado,
      email: empleado.email,
      id_sucursal: empleado.id_sucursal, 
      token: token
    });
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
};