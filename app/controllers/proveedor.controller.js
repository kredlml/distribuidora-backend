const db = require("../models");
const Proveedor = db.proveedor;
const { registrarAuditoria } = require("../utils/auditoria");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Campos de texto editables y su largo máximo (columnas del modelo).
const CAMPOS = { nombre_empresa: 120, nombre_contacto: 100, telefono: 20, email: 120, direccion: 200 };

// Lee y valida los datos de un proveedor (lista blanca). En el alta nombre_empresa es obligatorio.
function leerDatos(body, { esAlta }) {
  const datos = {};
  for (const [campo, max] of Object.entries(CAMPOS)) {
    if (body[campo] === undefined) {
      if (esAlta && campo === "nombre_empresa") return { error: "El nombre de la empresa es obligatorio." };
      continue;
    }
    const s = body[campo] === null ? "" : String(body[campo]).trim();
    if (campo === "nombre_empresa" && !s) return { error: "El nombre de la empresa es obligatorio." };
    if (s.length > max) return { error: `El campo ${campo} no puede superar los ${max} caracteres.` };
    if (campo === "email" && s && !EMAIL_RE.test(s)) return { error: "El email no es válido." };
    datos[campo] = campo === "email" ? (s.toLowerCase() || null) : (s || null);
  }
  if (body.activo !== undefined) {
    if (typeof body.activo !== "boolean") return { error: "El campo activo debe ser verdadero o falso." };
    datos.activo = body.activo;
  }
  return { datos };
}

exports.create = async (req, res) => {
  try {
    const { datos, error } = leerDatos(req.body || {}, { esAlta: true });
    if (error) return res.status(400).send({ message: error });
    const data = await db.sequelize.transaction(async (t) => {
      const p = await Proveedor.create({ activo: true, ...datos }, { transaction: t });
      await registrarAuditoria({
        id_empleado: req.empleadoId, accion: 'PROVEEDOR_CREADO', tabla_afectada: 'Proveedor',
        registro_afectado_id: p.id_proveedor, detalles: `Proveedor #${p.id_proveedor} (${p.nombre_empresa}) creado.`.slice(0, 255)
      }, t);
      return p;
    });
    res.status(201).send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al crear el Proveedor." });
  }
};

exports.findAll = async (req, res) => {
  try {
    const data = await Proveedor.findAll({ order: [['nombre_empresa', 'ASC']] });
    res.send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al recuperar los proveedores." });
  }
};

// PUT /api/proveedores/:id — solo los campos enviados; cada cambio real queda en auditoría.
exports.update = async (req, res) => {
  try {
    const { datos, error } = leerDatos(req.body || {}, { esAlta: false });
    if (error) return res.status(400).send({ message: error });
    if (Object.keys(datos).length === 0) {
      return res.status(400).send({ message: "No se enviaron cambios (nombre_empresa, nombre_contacto, telefono, email, direccion, activo)." });
    }
    const proveedor = await db.sequelize.transaction(async (t) => {
      const p = await Proveedor.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!p) return null;
      const diffs = Object.keys(datos).filter((k) => (p[k] ?? null) !== datos[k])
        .map((k) => `${k}: ${p[k] ?? "vacío"} → ${datos[k] ?? "vacío"}`);
      if (diffs.length) {
        await p.update(datos, { transaction: t });
        await registrarAuditoria({
          id_empleado: req.empleadoId, accion: 'PROVEEDOR_ACTUALIZADO', tabla_afectada: 'Proveedor',
          registro_afectado_id: p.id_proveedor, detalles: `Proveedor #${p.id_proveedor} actualizado. ${diffs.join("; ")}`.slice(0, 255)
        }, t);
      }
      return p;
    });
    if (!proveedor) return res.status(404).send({ message: `No se encontró el proveedor con id=${req.params.id}.` });
    res.send(proveedor);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al actualizar el Proveedor." });
  }
};

// DELETE /api/proveedores/:id — los proveedores no se relacionan con otros registros, así que
// se pueden eliminar (solo ADMIN). Para dejar de usarlo conservando el dato, desactivarlo.
exports.delete = async (req, res) => {
  try {
    const nombre = await db.sequelize.transaction(async (t) => {
      const p = await Proveedor.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!p) return null;
      await p.destroy({ transaction: t });
      await registrarAuditoria({
        id_empleado: req.empleadoId, accion: 'PROVEEDOR_ELIMINADO', tabla_afectada: 'Proveedor',
        registro_afectado_id: p.id_proveedor, detalles: `Proveedor #${p.id_proveedor} (${p.nombre_empresa}) eliminado.`.slice(0, 255)
      }, t);
      return p.nombre_empresa;
    });
    if (!nombre) return res.status(404).send({ message: `No se encontró el proveedor con id=${req.params.id}.` });
    res.send({ message: `Proveedor «${nombre}» eliminado.` });
  } catch (error) {
    if (error.name === "SequelizeForeignKeyConstraintError") {
      return res.status(409).send({ message: "No se puede eliminar: el proveedor tiene registros asociados. Desactívalo desde Editar." });
    }
    res.status(500).send({ message: error.message || "Error al eliminar el Proveedor." });
  }
};
