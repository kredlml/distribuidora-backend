const db = require("../models");
const Categoria = db.categoria;
const { registrarAuditoria } = require("../utils/auditoria");

// Nombre: obligatorio, sin espacios sobrantes y de hasta 60 caracteres (columna STRING(60) UNIQUE).
// Descripción: opcional, hasta 200 (vacío = sin descripción). Devuelven { valor } o { error }.
function validarNombre(v) {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return { error: "El nombre del tipo de prenda es obligatorio." };
  if (s.length > 60) return { error: "El nombre no puede superar los 60 caracteres." };
  return { valor: s };
}
function validarDescripcion(v) {
  if (v === undefined) return {};
  if (v === null || String(v).trim() === "") return { valor: null };
  const s = String(v).trim();
  if (s.length > 200) return { error: "La descripción no puede superar los 200 caracteres." };
  return { valor: s };
}

// ¿Ya existe otro tipo con ese nombre? (sin distinguir mayúsculas, para no tener "Camisas" y "camisas").
async function nombreRepetido(nombre, idExcluir, t) {
  const where = db.sequelize.where(db.sequelize.fn("lower", db.sequelize.col("nombre")), nombre.toLowerCase());
  const otro = await Categoria.findOne({ where, transaction: t });
  return otro && otro.id_categoria !== Number(idExcluir);
}

exports.create = async (req, res) => {
  try {
    const body = req.body || {};
    const nombre = validarNombre(body.nombre);
    if (nombre.error) return res.status(400).send({ message: nombre.error });
    const descripcion = validarDescripcion(body.descripcion);
    if (descripcion.error) return res.status(400).send({ message: descripcion.error });
    if (await nombreRepetido(nombre.valor, null)) {
      return res.status(400).send({ message: `Ya existe un tipo de prenda llamado «${nombre.valor}».` });
    }
    // Si dos altas iguales llegan a la vez, el índice único lower(nombre) rechaza la segunda (400 abajo).
    const data = await Categoria.create({ nombre: nombre.valor, descripcion: descripcion.valor ?? null });
    res.status(201).send(data);
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(400).send({ message: "Ya existe un tipo de prenda con ese nombre." });
    }
    res.status(500).send({ message: error.message || "Error al crear la Categoría." });
  }
};

exports.findAll = async (req, res) => {
  try {
    const data = await Categoria.findAll({ order: [['nombre', 'ASC']] });
    res.send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al recuperar las categorías." });
  }
};

// PUT /api/categorias/:id — edita nombre y/o descripción. Cada cambio real queda en auditoría.
exports.update = async (req, res) => {
  try {
    const body = req.body || {};
    const cambios = {};
    let nombre;
    if (body.nombre !== undefined) {
      nombre = validarNombre(body.nombre);
      if (nombre.error) return res.status(400).send({ message: nombre.error });
      cambios.nombre = nombre.valor;
    }
    const descripcion = validarDescripcion(body.descripcion);
    if (descripcion.error) return res.status(400).send({ message: descripcion.error });
    if (descripcion.valor !== undefined) cambios.descripcion = descripcion.valor;
    if (Object.keys(cambios).length === 0) {
      return res.status(400).send({ message: "No se enviaron cambios (nombre, descripcion)." });
    }

    // Se lee y bloquea dentro de la transacción: si otro ADMIN la elimina o edita a la vez,
    // las operaciones se ordenan y nunca se audita un cambio sobre una fila ya borrada.
    const resultado = await db.sequelize.transaction(async (t) => {
      const categoria = await Categoria.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!categoria) return { status: 404, message: `No se encontró el tipo de prenda con id=${req.params.id}.` };
      if (nombre && await nombreRepetido(nombre.valor, categoria.id_categoria, t)) {
        return { status: 400, message: `Ya existe un tipo de prenda llamado «${nombre.valor}».` };
      }
      const diffs = Object.keys(cambios).filter((k) => (categoria[k] ?? null) !== cambios[k])
        .map((k) => `${k}: ${categoria[k] ?? "vacío"} → ${cambios[k] ?? "vacío"}`);
      if (diffs.length === 0) return { status: 200, categoria }; // nada cambió: no se audita
      await categoria.update(cambios, { transaction: t });
      await registrarAuditoria({
        id_empleado: req.empleadoId, accion: 'CATEGORIA_ACTUALIZADA', tabla_afectada: 'Categoria',
        registro_afectado_id: categoria.id_categoria,
        detalles: `Tipo de prenda #${categoria.id_categoria} actualizado. ${diffs.join("; ")}`.slice(0, 255)
      }, t);
      return { status: 200, categoria };
    });
    if (resultado.status !== 200) return res.status(resultado.status).send({ message: resultado.message });
    res.send(resultado.categoria);
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(400).send({ message: "Ya existe un tipo de prenda con ese nombre." });
    }
    res.status(500).send({ message: error.message || "Error al actualizar la Categoría." });
  }
};

// DELETE /api/categorias/:id — solo si ninguna prenda (activa o no) usa este tipo; si no, 409:
// hay que mover esas prendas a otro tipo primero (Editar prenda), así nunca quedan huérfanas.
exports.delete = async (req, res) => {
  try {
    const id = req.params.id;
    const resultado = await db.sequelize.transaction(async (t) => {
      const categoria = await Categoria.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!categoria) return { status: 404, message: `No se encontró el tipo de prenda con id=${id}.` };
      const prendas = await db.producto.count({ where: { id_categoria: categoria.id_categoria }, transaction: t });
      if (prendas > 0) {
        return {
          status: 409,
          message: `No se puede eliminar «${categoria.nombre}» porque ${prendas} prenda(s) lo usan. Cámbialas a otro tipo desde Editar prenda y vuelve a intentarlo.`
        };
      }
      await categoria.destroy({ transaction: t });
      await registrarAuditoria({
        id_empleado: req.empleadoId, accion: 'CATEGORIA_ELIMINADA', tabla_afectada: 'Categoria',
        registro_afectado_id: categoria.id_categoria,
        detalles: `Tipo de prenda #${categoria.id_categoria} (${categoria.nombre}) eliminado.`.slice(0, 255)
      }, t);
      return { status: 200, message: `Tipo de prenda «${categoria.nombre}» eliminado.` };
    });
    res.status(resultado.status).send({ message: resultado.message });
  } catch (error) {
    if (error.name === "SequelizeForeignKeyConstraintError") {
      return res.status(409).send({ message: "No se puede eliminar: hay prendas que usan este tipo." });
    }
    res.status(500).send({ message: error.message || "Error al eliminar la Categoría." });
  }
};
