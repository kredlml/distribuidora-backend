const db = require("../models");
const Empleado = db.empleado;
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { PUESTOS_VALIDOS } = require("../middlewares/authJwt.js");
const { registrarAuditoria } = require("../utils/auditoria");

// POST /api/auth/registro — protegido por permitirRegistro: solo un ADMIN registra empleados.
// Excepción: con la base vacía (req.registroInicial) el primer empleado queda siempre como ADMIN.
exports.registro = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.password) {
      return res.status(400).send({ message: "¡La contraseña es obligatoria!" });
    }
    if (!body.nombre || !body.email) {
      return res.status(400).send({ message: "El nombre y el email son obligatorios." });
    }

    const puesto = req.registroInicial ? "ADMIN" : String(body.puesto || "").trim().toUpperCase();
    if (!PUESTOS_VALIDOS.includes(puesto)) {
      return res.status(400).send({ message: `El puesto debe ser uno de: ${PUESTOS_VALIDOS.join(", ")}.` });
    }
    if (await Empleado.findOne({ where: { email: body.email } })) {
      return res.status(400).send({ message: "Ya existe un empleado registrado con ese email." });
    }
    if (body.id_sucursal && !(await db.sucursal.findByPk(body.id_sucursal))) {
      return res.status(400).send({ message: `La sucursal ${body.id_sucursal} no existe.` });
    }

    const nuevoEmpleado = await Empleado.create({
      nombre: body.nombre,
      apellido: body.apellido,
      puesto,
      email: body.email,
      password: bcrypt.hashSync(body.password, 8),
      id_sucursal: body.id_sucursal || null
    });

    await registrarAuditoria({
      id_empleado: req.empleadoId || nuevoEmpleado.id_empleado,
      accion: req.registroInicial ? 'EMPLEADO_REGISTRO_INICIAL' : 'EMPLEADO_REGISTRADO',
      tabla_afectada: 'Empleado',
      registro_afectado_id: nuevoEmpleado.id_empleado,
      detalles: `Empleado #${nuevoEmpleado.id_empleado} (${body.email}) registrado con puesto ${puesto}.`
    });

    res.status(201).send({ message: "Empleado registrado exitosamente.", id: nuevoEmpleado.id_empleado, puesto });
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
};


exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).send({ message: "El email y la contraseña son obligatorios." });
    }

    const empleado = await Empleado.findOne({ where: { email } });

    if (!empleado) {
      return res.status(404).send({ message: "Empleado no encontrado." });
    }

    // Empleados dados de alta por /api/empleados no tienen contraseña: no pueden iniciar sesión.
    const passwordValido = !!empleado.password && bcrypt.compareSync(password, empleado.password);

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
      nombre: empleado.nombre,
      apellido: empleado.apellido,
      puesto: empleado.puesto,
      id_sucursal: empleado.id_sucursal, 
      token: token
    });
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
};