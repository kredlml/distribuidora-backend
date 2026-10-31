const db = require("../models");
const Sucursal = db.sucursal;
const { registrarAuditoria } = require("../utils/auditoria");

// Campos editables de una sucursal y su largo máximo (columnas del modelo). Nunca se aceptan
// id_sucursal ni columnas no previstas. Devuelve { cambios } o { error }.
const CAMPOS_TEXTO_OBLIGATORIOS = { nombre: 100, direccion: 200, ciudad: 80 };

function leerCampos(body, { esAlta }) {
  const cambios = {};
  for (const [campo, max] of Object.entries(CAMPOS_TEXTO_OBLIGATORIOS)) {
    if (body[campo] === undefined) {
      if (esAlta) return { error: "El nombre, dirección y ciudad son obligatorios." };
      continue;
    }
    if (typeof body[campo] !== 'string' || !body[campo].trim()) {
      return { error: `El campo ${campo} no puede quedar vacío.` };
    }
    if (body[campo].trim().length > max) return { error: `El campo ${campo} no puede superar los ${max} caracteres.` };
    cambios[campo] = body[campo].trim();
  }
  if (body.telefono !== undefined) {
    const tel = body.telefono === null ? "" : String(body.telefono).trim();
    if (tel.length > 20) return { error: "El teléfono no puede superar los 20 caracteres." };
    cambios.telefono = tel || null;
  }
  if (body.activo !== undefined) {
    if (typeof body.activo !== 'boolean') return { error: "El campo activo debe ser verdadero o falso." };
    cambios.activo = body.activo;
  }
  return { cambios };
}

exports.create = async (req, res) => {
  try {
    const { cambios, error } = leerCampos(req.body || {}, { esAlta: true });
    if (error) return res.status(400).send({ message: error });

    const data = await db.sequelize.transaction(async (t) => {
      const sucursal = await Sucursal.create({ activo: true, ...cambios }, { transaction: t });
      await registrarAuditoria({
        id_empleado: req.empleadoId, accion: 'SUCURSAL_CREADA', tabla_afectada: 'Sucursal',
        registro_afectado_id: sucursal.id_sucursal, detalles: `Nueva sucursal creada: ${sucursal.nombre}`.slice(0, 255)
      }, t);
      return sucursal;
    });
    res.status(201).send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Ocurrió un error al crear la Sucursal." });
  }
};


exports.findAll = async (req, res) => {
  try {
    const data = await Sucursal.findAll({ order: [['id_sucursal', 'ASC']] });
    res.send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Ocurrió un error al recuperar las sucursales." });
  }
};

// PUT /api/sucursales/:id — solo aplica los campos enviados; cada cambio real queda en auditoría.
exports.update = async (req, res) => {
  try {
    const { cambios, error } = leerCampos(req.body || {}, { esAlta: false });
    if (error) return res.status(400).send({ message: error });
    if (Object.keys(cambios).length === 0) {
      return res.status(400).send({ message: "No se enviaron cambios válidos (nombre, direccion, ciudad, telefono, activo)." });
    }

    // Lectura con bloqueo dentro de la transacción: se ordena con un DELETE o PUT simultáneo.
    const sucursal = await db.sequelize.transaction(async (t) => {
      const fila = await Sucursal.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!fila) return null;
      const diffs = Object.keys(cambios).filter((k) => (fila[k] ?? null) !== cambios[k])
        .map((k) => `${k}: ${fila[k] ?? "vacío"} → ${cambios[k] ?? "vacío"}`);
      if (diffs.length) {
        await fila.update(cambios, { transaction: t });
        await registrarAuditoria({
          id_empleado: req.empleadoId, accion: 'SUCURSAL_ACTUALIZADA', tabla_afectada: 'Sucursal',
          registro_afectado_id: fila.id_sucursal,
          detalles: `Sucursal #${fila.id_sucursal} actualizada. ${diffs.join("; ")}`.slice(0, 255)
        }, t);
      }
      return fila;
    });
    if (!sucursal) {
      return res.status(404).send({ message: `No se encontró la sucursal con id=${req.params.id}.` });
    }
    res.send({ message: "La sucursal fue actualizada exitosamente.", sucursal });
  } catch (error) {
    res.status(500).send({ message: "Error al actualizar la sucursal con id=" + req.params.id });
  }
};

// DELETE /api/sucursales/:id — solo si la sucursal nunca tuvo actividad (empleados, inventario
// ni pedidos). Si ya tiene historial se responde 409: lo correcto es desactivarla (activo=false),
// así deja de vender en la tienda sin perder pedidos, movimientos ni auditoría.
exports.delete = async (req, res) => {
  const id = req.params.id;
  try {
    const resultado = await db.sequelize.transaction(async (t) => {
      const sucursal = await Sucursal.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!sucursal) return { status: 404, message: `No se encontró la sucursal con id=${id}.` };
      const where = { id_sucursal: sucursal.id_sucursal };
      const [empleados, inventario, pedidos, clientes, comprobantes] = await Promise.all([
        db.empleado.count({ where, transaction: t }),
        db.inventario.count({ where, transaction: t }),
        db.pedido.count({ where, transaction: t }),
        db.cliente.count({ where, transaction: t }),
        db.comprobante.count({ where, transaction: t })
      ]);
      const motivos = [];
      if (empleados) motivos.push(`tiene ${empleados} empleado(s) asignado(s)`);
      if (clientes) motivos.push(`tiene ${clientes} cliente(s) registrado(s)`);
      if (inventario) motivos.push("tiene registros de inventario");
      if (pedidos) motivos.push(`tiene ${pedidos} pedido(s)`);
      if (comprobantes) motivos.push(`tiene ${comprobantes} comprobante(s) de mercadería`);
      if (motivos.length) {
        return {
          status: 409,
          message: `No se puede eliminar la sucursal «${sucursal.nombre}» porque ${motivos.join(", ")}. Desactívala desde Editar para que deje de operar sin perder el historial.`
        };
      }
      await sucursal.destroy({ transaction: t });
      await registrarAuditoria({
        id_empleado: req.empleadoId, accion: 'SUCURSAL_ELIMINADA', tabla_afectada: 'Sucursal',
        registro_afectado_id: sucursal.id_sucursal, detalles: `Sucursal #${sucursal.id_sucursal} (${sucursal.nombre}) eliminada.`.slice(0, 255)
      }, t);
      return { status: 200, message: `La sucursal «${sucursal.nombre}» fue eliminada.` };
    });
    res.status(resultado.status).send({ message: resultado.message });
  } catch (err) {
    if (err.name === "SequelizeForeignKeyConstraintError") {
      return res.status(409).send({ message: "No se puede eliminar: la sucursal ya tiene registros asociados. Desactívala desde Editar." });
    }
    res.status(500).send({ message: "No se pudo eliminar la sucursal con id=" + id });
  }
};
