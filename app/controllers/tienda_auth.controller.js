const db = require("../models");
const Cliente = db.cliente;
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { registrarAuditoria } = require("../utils/auditoria");
const { hashCodigo } = require("./cliente.controller");

// Cuentas de clientes de la tienda en línea. El token lleva tipo CLIENTE para que nunca
// sirva en el panel de empleados (verificarToken lo rechaza) y viceversa (verificarCliente).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function firmarToken(cliente) {
  return jwt.sign({ id_cliente: cliente.id_cliente, tipo: "CLIENTE" }, process.env.JWT_SECRET, { expiresIn: 86400 }); // 24 horas
}

// Datos públicos del cliente (nunca el hash de contraseña ni el código de activación).
function perfilDe(cliente) {
  const { password, codigo_activacion, codigo_activacion_expira, ...datos } = cliente.get({ plain: true });
  return datos;
}

// Texto opcional recortado; "" → null. Lanza si supera el máximo de la columna.
function textoOpcional(valor, campo, max) {
  if (valor === undefined) return undefined;
  if (valor === null || String(valor).trim() === "") return null;
  const s = String(valor).trim();
  if (s.length > max) throw new Error(`El campo ${campo} no puede superar los ${max} caracteres.`);
  return s;
}

// POST /api/tienda/auth/registro — { nombre, apellido, email, password, telefono?, direccion? }
exports.registro = async (req, res) => {
  try {
    const b = req.body || {};
    const nombre = String(b.nombre || "").trim();
    const apellido = String(b.apellido || "").trim();
    const email = String(b.email || "").trim().toLowerCase();

    if (!nombre || !apellido || !email || !b.password) {
      return res.status(400).send({ message: "Nombre, apellido, email y contraseña son obligatorios." });
    }
    if (nombre.length > 80 || apellido.length > 80) {
      return res.status(400).send({ message: "El nombre y el apellido no pueden superar los 80 caracteres." });
    }
    if (!EMAIL_RE.test(email) || email.length > 120) {
      return res.status(400).send({ message: "El email no es válido." });
    }
    if (String(b.password).length < 8) {
      return res.status(400).send({ message: "La contraseña debe tener al menos 8 caracteres." });
    }
    let telefono, direccion;
    try {
      telefono = textoOpcional(b.telefono, "telefono", 20);
      direccion = textoOpcional(b.direccion, "direccion", 200);
    } catch (e) {
      return res.status(400).send({ message: e.message });
    }

    // Si el email ya existe no se permite tomar esa ficha registrándose: no hay forma de verificar
    // que el correo sea de quien se registra. Un cliente de mostrador activa su cuenta con el
    // código que le da caja en persona (POST /api/tienda/auth/activar).
    const existente = await Cliente.scope('conPassword').findOne({ where: db.sequelize.where(db.sequelize.fn('lower', db.sequelize.col('email')), email) });
    if (existente) {
      return res.status(400).send({
        message: existente.password
          ? "Ya existe una cuenta con ese email. Inicia sesión o usa otro correo."
          : "Ese correo ya está registrado en una de nuestras tiendas. Pide en caja tu código de activación y usa «Activar cuenta» para conservar tu historial."
      });
    }

    const cliente = await Cliente.create({
      nombre, apellido, email, telefono, direccion,
      activo: true,
      password: bcrypt.hashSync(String(b.password), 8)
    });

    res.status(201).send({ token: firmarToken(cliente), cliente: perfilDe(cliente) });
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al registrar la cuenta." });
  }
};

// POST /api/tienda/auth/activar — { email, codigo, password }. Un cliente registrado en mostrador
// crea su contraseña con el código de un solo uso que le entregó caja; conserva su ficha y su
// historial de pedidos. Mismo mensaje para correo inexistente, código incorrecto o vencido.
const ACTIVACION_INVALIDA = "El correo o el código no son válidos, o el código ya venció. Pide uno nuevo en caja.";
exports.activar = async (req, res) => {
  try {
    const b = req.body || {};
    const email = String(b.email || "").trim().toLowerCase();
    if (!email || !b.codigo || !b.password) {
      return res.status(400).send({ message: "El email, el código y la nueva contraseña son obligatorios." });
    }
    if (String(b.password).length < 8) {
      return res.status(400).send({ message: "La contraseña debe tener al menos 8 caracteres." });
    }
    const hash = hashCodigo(b.codigo);

    const cliente = await db.sequelize.transaction(async (t) => {
      const c = await Cliente.scope('conCodigo').findOne({
        where: db.sequelize.where(db.sequelize.fn('lower', db.sequelize.col('email')), email),
        transaction: t, lock: t.LOCK.UPDATE
      });
      const vigente = c && !c.password && c.activo && c.codigo_activacion && c.codigo_activacion_expira && new Date(c.codigo_activacion_expira) > new Date();
      const coincide = vigente && crypto.timingSafeEqual(Buffer.from(c.codigo_activacion, 'hex'), Buffer.from(hash, 'hex'));
      if (!coincide) return null;
      await c.update({ password: bcrypt.hashSync(String(b.password), 8), codigo_activacion: null, codigo_activacion_expira: null }, { transaction: t });
      await registrarAuditoria({
        id_empleado: null, accion: 'CLIENTE_CUENTA_WEB_ACTIVADA', tabla_afectada: 'Cliente',
        registro_afectado_id: c.id_cliente, detalles: `El cliente #${c.id_cliente} activó su cuenta web con código de caja.`
      }, t);
      return c;
    });
    if (!cliente) return res.status(400).send({ message: ACTIVACION_INVALIDA });

    res.status(200).send({ token: firmarToken(cliente), cliente: perfilDe(cliente) });
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al activar la cuenta." });
  }
};

// POST /api/tienda/auth/login — { email, password }
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).send({ message: "El email y la contraseña son obligatorios." });
    }

    const cliente = await Cliente.scope('conPassword').findOne({
      where: db.sequelize.where(db.sequelize.fn('lower', db.sequelize.col('email')), String(email).trim().toLowerCase())
    });
    // Mismo mensaje para "no existe" y "contraseña incorrecta": no revela qué correos tienen cuenta.
    const valido = cliente && cliente.password && bcrypt.compareSync(String(password), cliente.password);
    if (!valido) {
      return res.status(401).send({ message: "Email o contraseña incorrectos." });
    }
    if (!cliente.activo) {
      return res.status(403).send({ message: "La cuenta está desactivada." });
    }

    res.status(200).send({ token: firmarToken(cliente), cliente: perfilDe(cliente) });
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al iniciar sesión." });
  }
};

// GET /api/tienda/perfil
exports.perfil = async (req, res) => {
  try {
    const cliente = await Cliente.findByPk(req.clienteId);
    res.send(perfilDe(cliente));
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al recuperar el perfil." });
  }
};

// PUT /api/tienda/perfil — { nombre?, apellido?, telefono?, direccion? } (el email no se cambia).
exports.actualizarPerfil = async (req, res) => {
  try {
    const b = req.body || {};
    const cambios = {};
    for (const campo of ["nombre", "apellido"]) {
      if (b[campo] !== undefined) {
        const v = String(b[campo] || "").trim();
        if (!v) return res.status(400).send({ message: `El campo ${campo} no puede quedar vacío.` });
        if (v.length > 80) return res.status(400).send({ message: `El campo ${campo} no puede superar los 80 caracteres.` });
        cambios[campo] = v;
      }
    }
    try {
      const telefono = textoOpcional(b.telefono, "telefono", 20);
      const direccion = textoOpcional(b.direccion, "direccion", 200);
      if (telefono !== undefined) cambios.telefono = telefono;
      if (direccion !== undefined) cambios.direccion = direccion;
    } catch (e) {
      return res.status(400).send({ message: e.message });
    }
    if (Object.keys(cambios).length === 0) {
      return res.status(400).send({ message: "No se enviaron cambios válidos (nombre, apellido, telefono, direccion)." });
    }

    const cliente = await Cliente.findByPk(req.clienteId);
    await cliente.update(cambios);
    res.send(perfilDe(cliente));
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al actualizar el perfil." });
  }
};
