const db = require("../models");
const Empleado = db.empleado;
const bcrypt = require("bcryptjs");
const { registrarAuditoria } = require("../utils/auditoria");
const { validarPassword, hashPassword, leerDatosEmpleado, buscarPorEmail, firmarToken, aplicarReglasDeGestion } = require("../utils/empleados");

// Candado de la transacción del registro inicial: dos registros simultáneos con la base vacía
// se ordenan y solo el primero queda como DISTRITAL.
const CANDADO_REGISTRO_INICIAL = 727001;

// POST /api/auth/registro — protegido por permitirRegistro: solo un ADMIN (de su sucursal: cajeros
// y bodegueros) o el DISTRITAL (cualquier puesto) registran empleados. Excepción: con la base
// vacía (req.registroInicial) el primer empleado queda siempre como DISTRITAL, sin sucursal.
exports.registro = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.password) {
      return res.status(400).send({ message: "¡La contraseña es obligatoria!" });
    }
    const errorPassword = validarPassword(body.password);
    if (errorPassword) return res.status(400).send({ message: errorPassword });

    const { datos, error } = await leerDatosEmpleado(
      { ...body, puesto: req.registroInicial ? "DISTRITAL" : body.puesto, activo: undefined },
      { esAlta: true }
    );
    if (error) return res.status(400).send({ message: error });
    if (req.registroInicial) {
      datos.id_sucursal = null;
    } else {
      const regla = aplicarReglasDeGestion(req.empleado, null, datos);
      if (regla) return res.status(regla.status).send({ message: regla.message });
    }

    const nuevoEmpleado = await db.sequelize.transaction(async (t) => {
      if (req.registroInicial) {
        await db.sequelize.query(`SELECT pg_advisory_xact_lock(${CANDADO_REGISTRO_INICIAL})`, { transaction: t });
        if (await Empleado.count({ transaction: t }) > 0) return null; // otro registro inicial ganó la carrera
      }
      const empleado = await Empleado.create({ id_sucursal: null, ...datos, activo: true, password: hashPassword(body.password) }, { transaction: t });
      await registrarAuditoria({
        id_empleado: req.empleadoId || empleado.id_empleado,
        accion: req.registroInicial ? 'EMPLEADO_REGISTRO_INICIAL' : 'EMPLEADO_REGISTRADO',
        tabla_afectada: 'Empleado',
        registro_afectado_id: empleado.id_empleado,
        detalles: `Empleado #${empleado.id_empleado} (${empleado.email}) registrado con puesto ${empleado.puesto}.`.slice(0, 255)
      }, t);
      return empleado;
    });
    if (!nuevoEmpleado) {
      return res.status(403).send({ message: "¡No se proporcionó un token de seguridad! Ya existe un administrador: solo un ADMIN puede registrar empleados." });
    }

    res.status(201).send({ message: "Empleado registrado exitosamente.", id: nuevoEmpleado.id_empleado, puesto: nuevoEmpleado.puesto });
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(400).send({ message: "Ya existe un empleado registrado con ese email." });
    }
    res.status(500).send({ message: error.message });
  }
};

// Mismo mensaje si el correo no existe o la contraseña no coincide: no revela qué correos están registrados.
const CREDENCIALES_INVALIDAS = "Correo o contraseña incorrectos.";
// Si el correo no existe se compara igual contra este hash, para que la respuesta tarde lo mismo.
const HASH_FICTICIO = bcrypt.hashSync("contraseña-ficticia-de-comparacion", 10);

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).send({ message: "El email y la contraseña son obligatorios." });
    }

    const empleado = await buscarPorEmail(email);

    // Empleados dados de alta por /api/empleados no tienen contraseña: no pueden iniciar sesión.
    const hash = empleado && empleado.password;
    const coincide = bcrypt.compareSync(String(password), hash || HASH_FICTICIO);
    const passwordValido = !!hash && coincide;

    if (!passwordValido) {
      return res.status(401).send({ token: null, message: CREDENCIALES_INVALIDAS });
    }
    if (empleado.activo === false) {
      return res.status(403).send({ token: null, message: "Tu cuenta está desactivada. Habla con un administrador." });
    }

    const token = firmarToken(empleado);

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

// GET /api/auth/yo — datos actuales del empleado del token (el panel los usa para refrescar el
// puesto si un ADMIN lo cambió después del login).
exports.yo = async (req, res) => {
  try {
    const e = req.empleado;
    const sucursal = e.id_sucursal ? await db.sucursal.findByPk(e.id_sucursal, { attributes: ['nombre'] }) : null;
    res.send({
      id: e.id_empleado, email: e.email, nombre: e.nombre, apellido: e.apellido, puesto: e.puesto,
      id_sucursal: e.id_sucursal, sucursal: sucursal ? sucursal.nombre : null
    });
  } catch (error) {
    res.status(500).send({ message: "Error al leer la sesión." });
  }
};

// PUT /api/auth/password — el propio empleado cambia su contraseña: { actual, nueva }.
// Cierra las demás sesiones (sube token_version) y devuelve un token nuevo para esta.
exports.cambiarPassword = async (req, res) => {
  try {
    const { actual, nueva } = req.body || {};
    if (!actual || !nueva) return res.status(400).send({ message: "Escribe tu contraseña actual y la nueva." });
    const errorPassword = validarPassword(nueva);
    if (errorPassword) return res.status(400).send({ message: errorPassword });

    const empleado = await Empleado.findByPk(req.empleadoId);
    if (!empleado.password || !bcrypt.compareSync(String(actual), empleado.password)) {
      return res.status(400).send({ message: "La contraseña actual no es correcta." });
    }
    if (bcrypt.compareSync(nueva, empleado.password)) {
      return res.status(400).send({ message: "La nueva contraseña debe ser distinta de la actual." });
    }
    await db.sequelize.transaction(async (t) => {
      await empleado.update({ password: hashPassword(nueva), token_version: (empleado.token_version || 0) + 1 }, { transaction: t });
      await registrarAuditoria({
        id_empleado: empleado.id_empleado, accion: 'EMPLEADO_PASSWORD_CAMBIADA', tabla_afectada: 'Empleado',
        registro_afectado_id: empleado.id_empleado, detalles: `Empleado #${empleado.id_empleado} cambió su contraseña.`
      }, t);
    });
    res.send({ message: "Contraseña actualizada. Se cerraron tus otras sesiones.", token: firmarToken(empleado) });
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al cambiar la contraseña." });
  }
};
