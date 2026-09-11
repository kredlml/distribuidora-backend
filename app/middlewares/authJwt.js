const jwt = require("jsonwebtoken");
const db = require("../models");
const Empleado = db.empleado; 

exports.verificarToken = (req, res, next) => {
  let tokenHeader = req.headers["authorization"];

  if (!tokenHeader) {
    return res.status(403).send({ message: "¡No se proporcionó un token de seguridad!" });
  }

  const token = tokenHeader.split(" ")[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "¡Token no autorizado o expirado!" });
    }
    
    req.empleadoId = decoded.id;
    next(); 
  });
};


exports.isAdmin = async (req, res, next) => {
  try {
    const empleado = await Empleado.findByPk(req.empleadoId);
    if (empleado && empleado.puesto.toUpperCase() === "ADMIN") {
      next();
      return;
    }
    res.status(403).send({ message: "¡Acceso denegado! Esta acción requiere privilegios de Administrador." });
  } catch (error) {
    res.status(500).send({ message: "Error al validar el rol de usuario." });
  }
};


exports.isCajero = async (req, res, next) => {
  try {
    const empleado = await Empleado.findByPk(req.empleadoId);
    if (empleado && (empleado.puesto.toUpperCase() === "CAJERO" || empleado.puesto.toUpperCase() === "ADMIN")) {
      next();
      return;
    }
    res.status(403).send({ message: "¡Acceso denegado! Solo los cajeros autorizados pueden realizar ventas." });
  } catch (error) {
    res.status(500).send({ message: "Error al validar el rol de usuario." });
  }
};


exports.isBodeguero = async (req, res, next) => {
  try {
    const empleado = await Empleado.findByPk(req.empleadoId);
    if (empleado && (empleado.puesto.toUpperCase() === "BODEGUERO" || empleado.puesto.toUpperCase() === "ADMIN")) {
      next();
      return;
    }
    res.status(403).send({ message: "¡Acceso denegado! Solo el personal de bodega puede alterar el inventario." });
  } catch (error) {
    res.status(500).send({ message: "Error al validar el rol de usuario." });
  }
};