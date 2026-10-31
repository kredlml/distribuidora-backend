const db = require("../models");
const Cliente = db.cliente;
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { registrarAuditoria } = require("../utils/auditoria");
const { hashCodigo } = require("./cliente.controller");
const notificaciones = require("../utils/notificaciones");

// Cuentas de clientes de la tienda en línea. El token lleva tipo CLIENTE para que nunca
// sirva en el panel de empleados (verificarToken lo rechaza) y viceversa (verificarCliente).

// Mismo criterio que el envío de correos: una cuenta con un correo al que no se puede escribir
// nunca recibiría avisos ni podría restablecer su contraseña.
const { EMAIL_VALIDO: EMAIL_RE } = require("../utils/correo");
const { contarIntento } = require("../middlewares/limitador");

// v = token_version: cambiar o restablecer la contraseña la aumenta y cierra las demás sesiones.
function firmarToken(cliente) {
  return jwt.sign({ id_cliente: cliente.id_cliente, tipo: "CLIENTE", v: cliente.token_version || 0 }, process.env.JWT_SECRET, { expiresIn: 86400 }); // 24 horas
}

// Datos públicos del cliente (nunca el hash de contraseña ni los códigos).
function perfilDe(cliente) {
  const { password, codigo_activacion, codigo_activacion_expira, reset_token_hash, reset_expira, token_version, ...datos } = cliente.get({ plain: true });
  return datos;
}

// bcrypt solo usa los primeros 72 bytes: una contraseña más larga se rechaza para que no
// "funcione" cualquier texto que empiece igual.
function errorPassword(password) {
  const p = String(password || "");
  if (p.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if (Buffer.byteLength(p, "utf8") > 72) return "La contraseña es demasiado larga (máximo 72 bytes).";
  return null;
}
// El hash va ligado al correo: si caja corrige el correo de la ficha, el enlace enviado al anterior deja de valer.
const hashToken = (email, token) => crypto.createHash("sha256").update(`${String(email).toLowerCase()}:${token}`).digest("hex");
const MAX_ENLACES_POR_HORA = 3; // por correo: nadie puede llenarle el buzón a otra persona
const MINUTOS_RESET = 60;
const HASH_FICTICIO = bcrypt.hashSync("contraseña-que-nadie-tiene", 8);
const porCorreo = (email) => db.sequelize.where(db.sequelize.fn('lower', db.sequelize.col('email')), email);

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
    if (errorPassword(b.password)) {
      return res.status(400).send({ message: errorPassword(b.password) });
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
    if (errorPassword(b.password)) {
      return res.status(400).send({ message: errorPassword(b.password) });
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
      await c.update({ password: bcrypt.hashSync(String(b.password), 8), codigo_activacion: null, codigo_activacion_expira: null, reset_token_hash: null, reset_expira: null, token_version: (c.token_version || 0) + 1 }, { transaction: t });
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
    // Mismo mensaje (y mismo tiempo: siempre se compara un hash) para "no existe" y "contraseña
    // incorrecta": no revela qué correos tienen cuenta.
    const hashAComparar = cliente && cliente.password ? cliente.password : HASH_FICTICIO;
    const valido = bcrypt.compareSync(String(password), hashAComparar) && !!(cliente && cliente.password);
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

// POST /api/tienda/auth/olvide — { email }. Si el correo es de una clienta activa, le envía un
// enlace de un solo uso (vence en 1 hora). La respuesta es SIEMPRE la misma para no revelar qué
// correos están registrados. También sirve a una clienta de mostrador: demostrar que recibe el
// correo es suficiente para crear su contraseña y conservar su historial.
const RESPUESTA_OLVIDE = "Si ese correo tiene una cuenta, te enviamos un enlace para crear una contraseña nueva. Revisa tu bandeja de entrada (y la de spam). El enlace vence en 1 hora.";
exports.olvide = async (req, res) => {
  try {
    const email = String((req.body || {}).email || "").trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email) || email.length > 120) {
      return res.status(400).send({ message: "Escribe un correo válido." });
    }
    // Más de MAX_ENLACES_POR_HORA para el mismo correo: misma respuesta, pero no se envía otro
    // (ni se invalida el enlace que ya tiene).
    const cuenta = await contarIntento(`olvide:${email}`, 3600);
    if (cuenta && cuenta.n > MAX_ENLACES_POR_HORA) return res.send({ message: RESPUESTA_OLVIDE });
    const token = crypto.randomBytes(32).toString("hex");
    const cliente = await db.sequelize.transaction(async (t) => {
      const c = await Cliente.scope('conReset').findOne({ where: porCorreo(email), transaction: t, lock: t.LOCK.UPDATE });
      if (!c || !c.activo) return null;
      await c.update({ reset_token_hash: hashToken(c.email, token), reset_expira: new Date(Date.now() + MINUTOS_RESET * 60000) }, { transaction: t });
      await registrarAuditoria({
        id_empleado: null, accion: 'CLIENTE_RESTABLECIMIENTO_SOLICITADO', tabla_afectada: 'Cliente',
        registro_afectado_id: c.id_cliente, detalles: `El cliente #${c.id_cliente} pidió restablecer su contraseña.`
      }, t);
      return c;
    });
    if (cliente) notificaciones.restablecerPassword(cliente, token);
    res.send({ message: RESPUESTA_OLVIDE });
  } catch (error) {
    res.status(500).send({ message: "No se pudo procesar la solicitud. Intenta de nuevo." });
  }
};

// POST /api/tienda/auth/restablecer — { email, token, password }. Usa el enlace del correo (una
// sola vez): guarda la contraseña nueva, invalida el enlace y cierra las demás sesiones.
const RESET_INVALIDO = "El enlace no es válido o ya venció. Pide uno nuevo desde «¿Olvidaste tu contraseña?».";
exports.restablecer = async (req, res) => {
  try {
    const b = req.body || {};
    const email = String(b.email || "").trim().toLowerCase();
    const token = String(b.token || "").trim();
    if (!email || !token) return res.status(400).send({ message: RESET_INVALIDO });
    if (errorPassword(b.password)) return res.status(400).send({ message: errorPassword(b.password) });

    const cliente = await db.sequelize.transaction(async (t) => {
      const c = await Cliente.scope('conReset').findOne({ where: porCorreo(email), transaction: t, lock: t.LOCK.UPDATE });
      const vigente = c && c.activo && c.reset_token_hash && c.reset_expira && new Date(c.reset_expira) > new Date();
      const coincide = vigente && /^[0-9a-f]{64}$/.test(token) && crypto.timingSafeEqual(Buffer.from(c.reset_token_hash, "hex"), Buffer.from(hashToken(c.email, token), "hex"));
      if (!coincide) return null;
      const eraDeMostrador = !c.password;
      await c.update({
        password: bcrypt.hashSync(String(b.password), 8),
        reset_token_hash: null, reset_expira: null,
        // Si tenía un código de caja pendiente, ya no hace falta.
        codigo_activacion: null, codigo_activacion_expira: null,
        token_version: (c.token_version || 0) + 1
      }, { transaction: t });
      await registrarAuditoria({
        id_empleado: null, accion: 'CLIENTE_PASSWORD_RESTABLECIDA', tabla_afectada: 'Cliente', registro_afectado_id: c.id_cliente,
        detalles: `El cliente #${c.id_cliente} ${eraDeMostrador ? 'creó su contraseña (cuenta web) con el enlace del correo' : 'restableció su contraseña con el enlace del correo'}.`
      }, t);
      return c;
    });
    if (!cliente) return res.status(400).send({ message: RESET_INVALIDO });
    notificaciones.passwordCambiada(cliente);
    res.send({ message: "Listo, tu contraseña cambió.", token: firmarToken(cliente), cliente: perfilDe(cliente) });
  } catch (error) {
    res.status(500).send({ message: "No se pudo cambiar la contraseña. Intenta de nuevo." });
  }
};

// PUT /api/tienda/perfil/password — { actual, nueva }. Con sesión iniciada; cierra las demás
// sesiones y devuelve un token nuevo para este dispositivo.
exports.cambiarPassword = async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.actual) return res.status(400).send({ message: "Escribe tu contraseña actual." });
    if (errorPassword(b.nueva)) return res.status(400).send({ message: errorPassword(b.nueva) });
    if (String(b.nueva) === String(b.actual)) return res.status(400).send({ message: "La contraseña nueva debe ser distinta de la actual." });
    const resultado = await db.sequelize.transaction(async (t) => {
      const c = await Cliente.scope('conPassword').findByPk(req.clienteId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!c.password || !bcrypt.compareSync(String(b.actual), c.password)) return { error: "La contraseña actual no es correcta." };
      // Un enlace de restablecimiento pendiente también deja de valer.
      await c.update({ password: bcrypt.hashSync(String(b.nueva), 8), token_version: (c.token_version || 0) + 1, reset_token_hash: null, reset_expira: null }, { transaction: t });
      await registrarAuditoria({
        id_empleado: null, accion: 'CLIENTE_PASSWORD_CAMBIADA', tabla_afectada: 'Cliente',
        registro_afectado_id: c.id_cliente, detalles: `El cliente #${c.id_cliente} cambió su contraseña desde su perfil.`
      }, t);
      return { c };
    });
    if (resultado.error) return res.status(400).send({ message: resultado.error });
    notificaciones.passwordCambiada(resultado.c);
    res.send({ message: "Tu contraseña cambió. Cerramos tus sesiones en otros dispositivos.", token: firmarToken(resultado.c) });
  } catch (error) {
    res.status(500).send({ message: "No se pudo cambiar la contraseña." });
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
