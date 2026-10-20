const db = require("../models");
const Inventario = db.inventario;
const { registrarAuditoria } = require("../utils/auditoria");

// Estados con los que se puede ingresar stock desde el panel (Catálogo > Ingresar stock).
const ESTADOS_INGRESO = ['DISPONIBLE', 'DANADA', 'DEFECTUOSA'];

// Motivos de un ajuste de salida (baja de stock). OTRO exige observación.
const MOTIVOS_AJUSTE = {
  CORRECCION_CONTEO: "Corrección por conteo físico",
  PERDIDA: "Pérdida o extravío",
  ROBO: "Robo",
  DANO: "Daño en bodega",
  DESCARTE: "Descarte de prenda dañada o defectuosa",
  OTRO: "Otro motivo"
};
const MAX_FILAS_AJUSTE = 200;

const esEnteroPositivo = (v) => Number.isInteger(Number(v)) && Number(v) > 0 && v !== "" && v !== null && typeof v !== "boolean";

exports.create = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.id_producto || !body.id_sucursal || body.cantidad === undefined) {
      return res.status(400).send({ message: "El id_producto, id_sucursal y cantidad son obligatorios." });
    }
    if (!esEnteroPositivo(body.cantidad)) {
      return res.status(400).send({ message: "La cantidad debe ser un número entero mayor a 0. Para bajar stock usa el ajuste de inventario de la sucursal." });
    }
    const estado = body.estado || 'DISPONIBLE';
    if (!ESTADOS_INGRESO.includes(estado)) {
      return res.status(400).send({ message: `El estado debe ser uno de: ${ESTADOS_INGRESO.join(", ")}.` });
    }
    const [producto, sucursal] = await Promise.all([
      db.producto.findByPk(body.id_producto),
      db.sucursal.findByPk(body.id_sucursal)
    ]);
    if (!producto) return res.status(400).send({ message: `La prenda ${body.id_producto} no existe.` });
    if (!sucursal) return res.status(400).send({ message: `La sucursal ${body.id_sucursal} no existe.` });

    const data = await Inventario.create({
      cantidad: Number(body.cantidad),
      id_producto: producto.id_producto,
      id_sucursal: sucursal.id_sucursal,
      lote: body.lote ? String(body.lote).trim().slice(0, 255) || null : null,
      estado
    });
    res.status(201).send(data);
  } catch (err) {
    res.status(500).send({ message: err.message || "Error al registrar el inventario." });
  }
};

// GET /api/inventario[?id_sucursal=N] — sin filtro devuelve todo (pantalla Inventario).
exports.findAll = async (req, res) => {
  try {
    const where = {};
    if (req.query.id_sucursal !== undefined) {
      if (!esEnteroPositivo(req.query.id_sucursal)) return res.status(400).send({ message: "id_sucursal debe ser un número válido." });
      where.id_sucursal = Number(req.query.id_sucursal);
    }
    const data = await Inventario.findAll({ where, order: [['id_producto', 'ASC'], ['id_inventario', 'ASC']] });
    res.send(data);
  } catch (err) {
    res.status(500).send({ message: err.message || "Error al recuperar inventarios." });
  }
};


exports.findOne = (req, res) => {
  const id = req.params.id;
  Inventario.findByPk(id)
    .then(data => res.send(data))
    .catch(err => res.status(500).send({ message: "Error al recuperar el inventario con id=" + id }));
};


exports.update = (req, res) => {
  const id = req.params.id;
  Inventario.update(req.body, { where: { id_inventario: id } })
    .then(num => {
      if (num == 1) { res.send({ message: "Inventario actualizado exitosamente." }); }
      else { res.send({ message: `No se pudo actualizar el inventario id=${id}.` }); }
    })
    .catch(err => res.status(500).send({ message: "Error actualizando inventario id=" + id }));
};


exports.delete = (req, res) => {
  const id = req.params.id;
  Inventario.destroy({ where: { id_inventario: id } })
    .then(num => {
      if (num == 1) { res.send({ message: "Inventario borrado exitosamente!" }); }
      else { res.send({ message: `No se pudo borrar el inventario id=${id}.` }); }
    })
    .catch(err => res.status(500).send({ message: "No se pudo borrar el inventario id=" + id }));
};

exports.MOTIVOS_AJUSTE = MOTIVOS_AJUSTE;

// POST /api/inventario/ajustes — baja de stock de una sucursal, una o varias filas de golpe.
// Body: { id_sucursal, motivo, observacion?, ajustes: [{ id_inventario, cantidad_actual, cantidad_nueva }] }
//  - Solo reduce (cantidad_nueva < actual); para sumar stock se usa POST /api/inventario.
//  - cantidad_actual es lo que vio el empleado: si el stock cambió entretanto (una venta, una
//    devolución) se responde 409 y no se toca nada, para no dar de baja unidades equivocadas.
//  - La fila no se borra (la referencian los movimientos): queda en 0 y cada baja deja un
//    movimiento AJUSTE_SALIDA en la trazabilidad, más una fila de auditoría por el ajuste.
exports.ajustar = async (req, res) => {
  try {
    const body = req.body || {};
    if (!esEnteroPositivo(body.id_sucursal)) return res.status(400).send({ message: "Indica la sucursal del ajuste." });
    const motivo = String(body.motivo || "").trim().toUpperCase();
    if (!MOTIVOS_AJUSTE[motivo]) {
      return res.status(400).send({ message: `El motivo debe ser uno de: ${Object.keys(MOTIVOS_AJUSTE).join(", ")}.` });
    }
    const observacion = body.observacion == null ? "" : String(body.observacion).trim();
    if (motivo === "OTRO" && !observacion) return res.status(400).send({ message: "Describe el motivo del ajuste en la observación." });
    if (observacion.length > 150) return res.status(400).send({ message: "La observación no puede superar los 150 caracteres." });

    const ajustes = Array.isArray(body.ajustes) ? body.ajustes : [];
    if (ajustes.length === 0) return res.status(400).send({ message: "Elige al menos una fila de inventario para ajustar." });
    if (ajustes.length > MAX_FILAS_AJUSTE) return res.status(400).send({ message: `Se pueden ajustar como máximo ${MAX_FILAS_AJUSTE} filas a la vez.` });
    const porId = new Map();
    for (const a of ajustes) {
      const ok = a && esEnteroPositivo(a.id_inventario) && Number.isInteger(Number(a.cantidad_actual)) && Number.isInteger(Number(a.cantidad_nueva)) &&
        a.cantidad_actual !== "" && a.cantidad_nueva !== "" && a.cantidad_actual !== null && a.cantidad_nueva !== null;
      if (!ok) return res.status(400).send({ message: "Cada ajuste necesita id_inventario, cantidad_actual y cantidad_nueva (enteros)." });
      const id = Number(a.id_inventario);
      if (porId.has(id)) return res.status(400).send({ message: `La fila de inventario #${id} viene repetida.` });
      const actual = Number(a.cantidad_actual), nueva = Number(a.cantidad_nueva);
      if (nueva < 0) return res.status(400).send({ message: `La cantidad nueva de la fila #${id} no puede ser negativa.` });
      if (nueva >= actual) {
        return res.status(400).send({ message: `La fila #${id}: el ajuste solo puede bajar el stock. Para ingresar unidades usa Catálogo > Ingresar stock.` });
      }
      porId.set(id, { actual, nueva });
    }

    const resultado = await db.sequelize.transaction(async (t) => {
      const sucursal = await db.sucursal.findByPk(body.id_sucursal, { transaction: t });
      if (!sucursal) return { status: 404, message: `La sucursal ${body.id_sucursal} no existe.` };

      // Mismo orden de bloqueo que las ventas (por prenda y luego por fila) para no provocar deadlocks.
      const filas = await Inventario.findAll({
        where: { id_inventario: [...porId.keys()] },
        order: [['id_producto', 'ASC'], ['id_inventario', 'ASC']],
        transaction: t,
        lock: t.LOCK.UPDATE
      });
      if (filas.length !== porId.size) {
        const faltan = [...porId.keys()].filter((id) => !filas.some((f) => f.id_inventario === id));
        return { status: 404, message: `No existen las filas de inventario: ${faltan.map((x) => "#" + x).join(", ")}.` };
      }
      const ajenas = filas.filter((f) => f.id_sucursal !== sucursal.id_sucursal);
      if (ajenas.length) {
        return { status: 400, message: `Las filas ${ajenas.map((f) => "#" + f.id_inventario).join(", ")} no pertenecen a la sucursal ${sucursal.nombre}.` };
      }
      const cambiadas = filas.filter((f) => f.cantidad !== porId.get(f.id_inventario).actual);
      if (cambiadas.length) {
        return {
          status: 409,
          message: `El stock cambió mientras lo editabas (filas ${cambiadas.map((f) => `#${f.id_inventario}: ahora hay ${f.cantidad}`).join(", ")}). Recarga y vuelve a intentarlo; no se aplicó ningún cambio.`
        };
      }

      const texto = `Ajuste de inventario: ${MOTIVOS_AJUSTE[motivo]}${observacion ? `. ${observacion}` : ""}`.slice(0, 255);
      let unidades = 0;
      for (const fila of filas) {
        const { actual, nueva } = porId.get(fila.id_inventario);
        fila.cantidad = nueva;
        await fila.save({ transaction: t });
        unidades += actual - nueva;
        await db.movimiento_inventario.create({
          id_inventario: fila.id_inventario,
          id_producto: fila.id_producto,
          id_empleado: req.empleadoId || null,
          tipo_movimiento: 'AJUSTE_SALIDA',
          cantidad: actual - nueva,
          estado_anterior: fila.estado,
          estado_nuevo: nueva === 0 ? 'AGOTADO' : fila.estado,
          observacion: texto
        }, { transaction: t });
      }
      await registrarAuditoria({
        id_empleado: req.empleadoId, accion: 'INVENTARIO_AJUSTADO', tabla_afectada: 'Inventario',
        registro_afectado_id: sucursal.id_sucursal,
        detalles: `Baja de ${unidades} u. en ${filas.length} fila(s) de la sucursal #${sucursal.id_sucursal} (${MOTIVOS_AJUSTE[motivo]}). Filas: ${filas.map((f) => "#" + f.id_inventario).join(", ")}`.slice(0, 255)
      }, t);
      return { status: 200, message: `Stock ajustado: se dieron de baja ${unidades} unidad(es) en ${filas.length} fila(s).`, unidades, filas };
    });
    res.status(resultado.status).send(resultado.status === 200 ? resultado : { message: resultado.message });
  } catch (err) {
    res.status(500).send({ message: err.message || "Error al ajustar el inventario." });
  }
};

exports.getStockGlobal = async (req, res) => {
  try {
    const stockGlobal = await Inventario.findAll({
      attributes: [
        'id_producto',
        'id_sucursal',
        [db.sequelize.fn('SUM', db.sequelize.col('cantidad')), 'stock_total']
      ],
      where: {
        estado: 'DISPONIBLE'
      },
      group: ['id_producto', 'id_sucursal']
    });

    res.status(200).send(stockGlobal);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al calcular el stock global." });
  }
};
