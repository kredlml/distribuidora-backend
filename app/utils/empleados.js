const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../models");
const { PUESTOS_VALIDOS, puestoDe } = require("../middlewares/authJwt");

// Reglas compartidas por el registro de empleados (auth.controller) y su edición (empleado.controller).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COSTO_BCRYPT = 10;

// Contraseña: mínimo 8 caracteres y máximo 72 (bcrypt ignora lo que pasa de 72 bytes).
function validarPassword(password) {
  if (typeof password !== "string" || password.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if (Buffer.byteLength(password, "utf8") > 72) return "La contraseña no puede superar los 72 caracteres.";
  return null;
}
const hashPassword = (password) => bcrypt.hashSync(password, COSTO_BCRYPT);

// Lee y valida los datos de un empleado. En el alta nombre, email y puesto son obligatorios;
// en la edición solo se validan los campos enviados. Devuelve { datos } o { error }.
async function leerDatosEmpleado(body, { esAlta, idExcluir } = {}) {
  const datos = {};
  for (const [campo, max, obligatorio] of [["nombre", 80, true], ["apellido", 80, false]]) {
    if (body[campo] === undefined) {
      if (esAlta && obligatorio) return { error: "El nombre y el email son obligatorios." };
      continue;
    }
    const s = body[campo] === null ? "" : String(body[campo]).trim();
    if (!s && obligatorio) return { error: `El ${campo} no puede quedar vacío.` };
    if (s.length > max) return { error: `El ${campo} no puede superar los ${max} caracteres.` };
    datos[campo] = s || null;
  }
  if (body.email !== undefined || esAlta) {
    const email = String(body.email || "").trim().toLowerCase();
    if (!email) return { error: "El nombre y el email son obligatorios." };
    if (!EMAIL_RE.test(email) || email.length > 120) return { error: "El email no es válido." };
    if (await buscarPorEmail(email, idExcluir)) return { error: "Ya existe un empleado registrado con ese email." };
    datos.email = email;
  }
  if (body.puesto !== undefined || esAlta) {
    const puesto = String(body.puesto || "").trim().toUpperCase();
    if (!PUESTOS_VALIDOS.includes(puesto)) return { error: `El puesto debe ser uno de: ${PUESTOS_VALIDOS.join(", ")}.` };
    datos.puesto = puesto;
  }
  if (body.id_sucursal !== undefined) {
    if (body.id_sucursal === null || body.id_sucursal === "") {
      datos.id_sucursal = null;
    } else {
      const sucursal = Number.isInteger(Number(body.id_sucursal)) ? await db.sucursal.findByPk(body.id_sucursal) : null;
      if (!sucursal) return { error: `La sucursal ${body.id_sucursal} no existe.` };
      datos.id_sucursal = sucursal.id_sucursal;
    }
  }
  if (body.activo !== undefined) {
    if (typeof body.activo !== "boolean") return { error: "El campo activo debe ser verdadero o falso." };
    datos.activo = body.activo;
  }
  return { datos };
}

// Email sin distinguir mayúsculas (hay cuentas antiguas guardadas con mayúsculas). Si una base
// antigua tuviera correos repetidos, se prefiere siempre la cuenta con contraseña y luego la más
// antigua, para que el resultado no dependa del orden físico de las filas.
function buscarPorEmail(email, idExcluir, opciones = {}) {
  const { Op } = db.Sequelize;
  const where = { [Op.and]: [db.sequelize.where(db.sequelize.fn("lower", db.sequelize.col("email")), String(email).trim().toLowerCase())] };
  if (idExcluir) where.id_empleado = { [Op.ne]: idExcluir };
  return db.empleado.findOne({ where, order: [[db.sequelize.literal('"password" IS NULL'), "ASC"], ["id_empleado", "ASC"]], ...opciones });
}

// ADMIN activos que pueden iniciar sesión (con contraseña), bloqueados para que dos cambios
// simultáneos no dejen el sistema sin ningún administrador utilizable.
function adminsActivos(t) {
  return db.empleado.findAll({
    where: { activo: true },
    attributes: ["id_empleado", "puesto", "password"],
    order: [["id_empleado", "ASC"]],
    transaction: t,
    lock: t.LOCK.UPDATE
  }).then((filas) => filas.filter((e) => puestoDe(e) === "ADMIN" && e.password).map((e) => ({ id_empleado: e.id_empleado })));
}

// JWT del panel. "v" es la versión de sesión del empleado (ver Empleado.token_version).
function firmarToken(empleado) {
  return jwt.sign(
    { id: empleado.id_empleado, id_sucursal: empleado.id_sucursal, v: empleado.token_version || 0 },
    process.env.JWT_SECRET,
    { expiresIn: 86400 } // 24 horas
  );
}

// Datos que se pueden mostrar de un empleado (nunca el hash de la contraseña ni la versión de sesión).
function publico(empleado) {
  const { password, token_version, ...datos } = empleado.get({ plain: true });
  return datos;
}

module.exports = { validarPassword, hashPassword, leerDatosEmpleado, buscarPorEmail, adminsActivos, firmarToken, publico };
