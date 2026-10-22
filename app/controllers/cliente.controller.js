const crypto = require("crypto");
const db = require("../models");
const Cliente = db.cliente;
const { registrarAuditoria } = require("../utils/auditoria");
const { puestoDe } = require("../middlewares/authJwt.js");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Código de activación web: 8 caracteres sin los que se confunden (0/O, 1/I/L), válido 72 horas.
const ALFABETO_CODIGO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const VIGENCIA_CODIGO_MS = 72 * 60 * 60 * 1000;

const hashCodigo = (codigo) => crypto.createHash("sha256").update(String(codigo).toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");
function generarCodigo() {
  const bytes = crypto.randomBytes(8);
  const c = [...bytes].map((b) => ALFABETO_CODIGO[b % ALFABETO_CODIGO.length]).join("");
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

// Datos que se pueden mostrar de un cliente: nunca el hash ni el código, sí si tiene cuenta web.
function publico(cliente, tieneCuentaWeb) {
  const { password, codigo_activacion, codigo_activacion_expira, ...datos } = cliente.get({ plain: true });
  return { ...datos, tiene_cuenta_web: tieneCuentaWeb !== undefined ? tieneCuentaWeb : !!password };
}

// Lee y valida los datos de un cliente. En el alta nombre y apellido son obligatorios; en la
// edición solo se validan los campos enviados. El email es opcional (cliente de mostrador
// "sin correo"), se guarda en minúsculas y no puede repetirse. Devuelve { datos } o { error }.
async function leerDatos(body, { esAlta, idExcluir } = {}) {
  const datos = {};
  for (const campo of ["nombre", "apellido"]) {
    if (body[campo] === undefined) {
      if (esAlta) return { error: "El nombre y apellido son obligatorios." };
      continue;
    }
    const s = body[campo] === null ? "" : String(body[campo]).trim();
    if (!s) return { error: `El ${campo} no puede quedar vacío.` };
    if (s.length > 80) return { error: `El ${campo} no puede superar los 80 caracteres.` };
    datos[campo] = s;
  }
  for (const [campo, max] of [["telefono", 20], ["direccion", 200]]) {
    if (body[campo] === undefined) continue;
    const s = body[campo] === null ? "" : String(body[campo]).trim();
    if (s.length > max) return { error: `El campo ${campo} no puede superar los ${max} caracteres.` };
    datos[campo] = s || null;
  }
  if (body.email !== undefined) {
    const email = body.email === null ? "" : String(body.email).trim().toLowerCase();
    if (email) {
      if (!EMAIL_RE.test(email) || email.length > 120) return { error: "El email no es válido." };
      const { Op } = db.Sequelize;
      const where = { [Op.and]: [db.sequelize.where(db.sequelize.fn("lower", db.sequelize.col("email")), email)] };
      if (idExcluir) where.id_cliente = { [Op.ne]: idExcluir };
      if (await Cliente.findOne({ where })) return { error: "Ya existe un cliente con ese email." };
    }
    datos.email = email || null;
  }
  if (body.activo !== undefined) {
    if (typeof body.activo !== "boolean") return { error: "El campo activo debe ser verdadero o falso." };
    datos.activo = body.activo;
  }
  return { datos };
}

// POST /api/clientes — alta en mostrador (CAJERO o ADMIN). Sin contraseña: si después quiere
// comprar en línea, caja le genera un código de activación (POST /:id/codigo-web).
exports.create = async (req, res) => {
  try {
    const body = req.body || {};
    const { datos, error } = await leerDatos({ ...body, activo: undefined }, { esAlta: true });
    if (error) return res.status(400).send({ message: error });

    const cliente = await db.sequelize.transaction(async (t) => {
      const c = await Cliente.create({ ...datos, activo: true }, { transaction: t });
      await registrarAuditoria({
        id_empleado: req.empleadoId, accion: 'CLIENTE_REGISTRADO', tabla_afectada: 'Cliente',
        registro_afectado_id: c.id_cliente, detalles: `Cliente #${c.id_cliente} (${c.nombre} ${c.apellido}) registrado en mostrador.`.slice(0, 255)
      }, t);
      return c;
    });
    res.status(201).send(publico(cliente, false));
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") return res.status(400).send({ message: "Ya existe un cliente con ese email." });
    res.status(500).send({ message: error.message || "Error al crear el Cliente." });
  }
};

// GET /api/clientes — lista para el panel (cualquier empleado). Indica si cada uno tiene cuenta web.
exports.findAll = async (req, res) => {
  try {
    const data = await Cliente.scope("conPassword").findAll({ order: [['id_cliente', 'ASC']] });
    res.send(data.map((c) => publico(c)));
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al recuperar los clientes." });
  }
};

// PUT /api/clientes/:id — CAJERO o ADMIN editan nombre, apellido, teléfono y dirección; el
// email solo si el cliente aún no tiene cuenta web (con cuenta, el correo es su usuario y lo
// cambia él). Activar/desactivar es solo de ADMIN (desactivado no puede comprar ni entrar).
exports.update = async (req, res) => {
  try {
    const body = req.body || {};
    const permitido = { nombre: body.nombre, apellido: body.apellido, telefono: body.telefono, direccion: body.direccion, email: body.email, activo: body.activo };
    if (permitido.activo !== undefined && puestoDe(req.empleado) !== "ADMIN") {
      return res.status(403).send({ message: "Solo un ADMIN puede activar o desactivar clientes." });
    }
    const { datos, error } = await leerDatos(permitido, { esAlta: false, idExcluir: Number(req.params.id) });
    if (error) return res.status(400).send({ message: error });
    if (Object.keys(datos).length === 0) {
      return res.status(400).send({ message: "No se enviaron cambios (nombre, apellido, telefono, direccion, email, activo)." });
    }

    const resultado = await db.sequelize.transaction(async (t) => {
      const cliente = await Cliente.scope("conCodigo").findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!cliente) return { status: 404, message: `No se encontró el cliente con id=${req.params.id}.` };
      if (datos.email !== undefined && cliente.password && datos.email !== cliente.email) {
        return { status: 400, message: "Este cliente ya tiene cuenta en la tienda: su correo es su usuario y no se cambia desde el panel." };
      }
      const cambios = { ...datos };
      // Si cambia el correo o se desactiva, un código de activación pendiente deja de valer
      // (al reactivar hará falta uno nuevo).
      if ((datos.email !== undefined && datos.email !== cliente.email) || datos.activo === false) {
        cambios.codigo_activacion = null; cambios.codigo_activacion_expira = null;
      }
      const diffs = Object.keys(datos).filter((k) => (cliente[k] ?? null) !== datos[k])
        .map((k) => `${k}: ${cliente[k] ?? "vacío"} → ${datos[k] ?? "vacío"}`);
      if (diffs.length) {
        await cliente.update(cambios, { transaction: t });
        await registrarAuditoria({
          id_empleado: req.empleadoId, accion: 'CLIENTE_ACTUALIZADO', tabla_afectada: 'Cliente',
          registro_afectado_id: cliente.id_cliente, detalles: `Cliente #${cliente.id_cliente} actualizado. ${diffs.join("; ")}`.slice(0, 255)
        }, t);
      }
      return { status: 200, cliente };
    });
    if (resultado.status !== 200) return res.status(resultado.status).send({ message: resultado.message });
    res.send(publico(resultado.cliente));
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") return res.status(400).send({ message: "Ya existe un cliente con ese email." });
    res.status(500).send({ message: error.message || "Error al actualizar el Cliente." });
  }
};

// POST /api/clientes/:id/codigo-web — genera el código de activación de la cuenta web de un
// cliente de mostrador. Se muestra UNA vez al cajero, que se lo entrega en persona; el cliente
// lo usa en la tienda (Activar cuenta) con su correo para crear su contraseña. Un código nuevo
// reemplaza al anterior. Solo se guarda su hash.
exports.generarCodigoWeb = async (req, res) => {
  try {
    const resultado = await db.sequelize.transaction(async (t) => {
      const cliente = await Cliente.scope("conCodigo").findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!cliente) return { status: 404, message: `No se encontró el cliente con id=${req.params.id}.` };
      if (!cliente.activo) return { status: 400, message: "El cliente está desactivado." };
      if (cliente.password) return { status: 400, message: "Este cliente ya tiene cuenta en la tienda en línea." };
      if (!cliente.email) return { status: 400, message: "Agrega primero el correo del cliente (Editar): con él iniciará sesión en la tienda." };
      const codigo = generarCodigo();
      const expira = new Date(Date.now() + VIGENCIA_CODIGO_MS);
      await cliente.update({ codigo_activacion: hashCodigo(codigo), codigo_activacion_expira: expira }, { transaction: t });
      await registrarAuditoria({
        id_empleado: req.empleadoId, accion: 'CLIENTE_CODIGO_WEB_GENERADO', tabla_afectada: 'Cliente',
        registro_afectado_id: cliente.id_cliente, detalles: `Código de activación web generado para el cliente #${cliente.id_cliente} (vence ${expira.toISOString()}).`
      }, t);
      return { status: 201, codigo, expira, email: cliente.email };
    });
    if (resultado.status !== 201) return res.status(resultado.status).send({ message: resultado.message });
    res.status(201).send({ codigo: resultado.codigo, expira: resultado.expira, email: resultado.email });
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al generar el código." });
  }
};

exports.hashCodigo = hashCodigo;
