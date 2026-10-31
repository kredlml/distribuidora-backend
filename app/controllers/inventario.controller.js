const db = require("../models");
const Inventario = db.inventario;
const { registrarAuditoria } = require("../utils/auditoria");
const { enAlcance, whereSucursal } = require("../utils/alcance");

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
const MAX_LINEAS_INGRESO = 100;
const MAX_CANTIDAD = 100000;
const MAX_COSTO = 1000000;
const texto = (v, max) => (v == null ? "" : String(v).trim()).slice(0, max);

// Valida una línea de ingreso; devuelve { linea } o { error }. `n` es su número (para el mensaje).
function leerLineaIngreso(l, n) {
  const pref = n ? `Línea ${n}: ` : "";
  if (!l || typeof l !== "object" || !l.id_producto || l.cantidad === undefined || l.cantidad === null || l.cantidad === "") {
    return { error: `${pref}la prenda y la cantidad son obligatorias.` };
  }
  if (!esEnteroPositivo(l.id_producto)) return { error: `${pref}la prenda no es válida.` };
  if (!esEnteroPositivo(l.cantidad) || Number(l.cantidad) > MAX_CANTIDAD) {
    return { error: `${pref}la cantidad debe ser un número entero entre 1 y ${MAX_CANTIDAD}. Para bajar stock usa el ajuste de inventario de la sucursal.` };
  }
  const estado = l.estado || "DISPONIBLE";
  if (!ESTADOS_INGRESO.includes(estado)) return { error: `${pref}el estado debe ser uno de: ${ESTADOS_INGRESO.join(", ")}.` };
  let costo = null;
  if (l.costo_unitario !== undefined && l.costo_unitario !== null && l.costo_unitario !== "") {
    const c = Number(l.costo_unitario);
    if (typeof l.costo_unitario === "boolean" || !Number.isFinite(c) || c < 0 || c > MAX_COSTO || Math.abs(Math.round(c * 100) - c * 100) > 1e-6) {
      return { error: `${pref}el costo unitario debe ser un monto válido (0 o más, con 2 decimales como máximo).` };
    }
    costo = Math.round(c * 100) / 100;
  }
  return { linea: { id_producto: Number(l.id_producto), cantidad: Number(l.cantidad), estado, lote: texto(l.lote, 255) || null, costo_unitario: costo } };
}

// El valor del ingreso debe caber en el comprobante (DECIMAL(12,2): menos de diez mil millones).
const MAX_VALOR = 9999999999.99;
function errorDeValor(lineas) {
  const total = lineas.reduce((s, l) => s + (l.costo_unitario == null ? 0 : l.costo_unitario * l.cantidad), 0);
  return total > MAX_VALOR ? "El valor del ingreso (cantidad × costo) es demasiado grande: revisa las cantidades y los costos." : null;
}
// Error inesperado: mensaje genérico al cliente y el detalle real al registro de errores.
function error500(res, err, mensaje) {
  res.locals.mensajeError = err && err.message;
  res.status(500).send({ message: mensaje });
}

// Registra un ingreso de mercadería: una fila de inventario (lote) por línea, su movimiento INGRESO
// y el comprobante de entrada, todo en una transacción. Devuelve { status, message } o
// { status: 201, comprobante, filas }.
async function registrarIngreso(req, { id_sucursal, id_proveedor, documento_proveedor, observacion, lineas }) {
  return db.sequelize.transaction(async (t) => {
    const sucursal = await db.sucursal.findByPk(id_sucursal, { transaction: t });
    if (!sucursal) return { status: 400, message: `La sucursal ${id_sucursal} no existe.` };
    let proveedor = null;
    if (id_proveedor) {
      proveedor = await db.proveedor.findByPk(id_proveedor, { transaction: t, lock: t.LOCK.SHARE });
      if (!proveedor) return { status: 400, message: `El proveedor ${id_proveedor} no existe.` };
      if (!proveedor.activo) return { status: 400, message: `El proveedor «${proveedor.nombre_empresa}» está inactivo: actívalo en Proveedores para registrarle ingresos.` };
    }
    const ids = [...new Set(lineas.map((l) => l.id_producto))];
    const productos = await db.producto.findAll({ where: { id_producto: ids }, attributes: ["id_producto"], transaction: t });
    const faltan = ids.filter((id) => !productos.some((p) => p.id_producto === id));
    if (faltan.length === 1) return { status: 400, message: `La prenda ${faltan[0]} no existe.` };
    if (faltan.length) return { status: 400, message: `No existen las prendas: ${faltan.map((x) => "#" + x).join(", ")}.` };

    const filas = [];
    for (const l of lineas) {
      filas.push(await Inventario.create({ cantidad: l.cantidad, id_producto: l.id_producto, id_sucursal: sucursal.id_sucursal, lote: l.lote, estado: l.estado }, { transaction: t }));
    }
    // El comprobante después de tocar el inventario: el contador es el último bloqueo.
    const { emitirComprobante } = require("../utils/comprobantes");
    const comprobante = await emitirComprobante({
      tipo: "ENTRADA",
      concepto: proveedor ? "INGRESO_PROVEEDOR" : "INGRESO_DIRECTO",
      id_sucursal: sucursal.id_sucursal,
      id_empleado: req.empleadoId,
      id_proveedor: proveedor ? proveedor.id_proveedor : null,
      documento_proveedor,
      motivo: observacion || (proveedor ? `Ingreso de mercadería de ${proveedor.nombre_empresa}.` : "Ingreso directo de mercadería."),
      lineas: lineas.map((l) => ({ id_producto: l.id_producto, cantidad: l.cantidad, estado_inventario: l.estado, lote: l.lote, valor_unitario: l.costo_unitario }))
    }, t);

    const origen = proveedor ? ` de ${proveedor.nombre_empresa}${documento_proveedor ? ` (documento ${documento_proveedor})` : ""}` : "";
    for (const [i, l] of lineas.entries()) {
      const fila = filas[i];
      await db.movimiento_inventario.create({
        id_inventario: fila.id_inventario,
        id_producto: l.id_producto,
        id_empleado: req.empleadoId || null,
        tipo_movimiento: 'INGRESO',
        cantidad: l.cantidad,
        estado_anterior: null,
        estado_nuevo: l.estado,
        observacion: `Ingreso ${comprobante.get("folio")}${origen}.`.slice(0, 255)
      }, { transaction: t });
    }
    const unidades = lineas.reduce((s, l) => s + l.cantidad, 0);
    await registrarAuditoria({
      id_empleado: req.empleadoId, accion: 'INVENTARIO_INGRESADO', tabla_afectada: 'Comprobante',
      registro_afectado_id: comprobante.id_comprobante,
      detalles: `${comprobante.get("folio")}: ingreso de ${unidades} u. en ${lineas.length} línea(s) a la sucursal #${sucursal.id_sucursal}${origen}.`.slice(0, 255)
    }, t);
    return { status: 201, comprobante, filas };
  });
}

// POST /api/inventario — ingreso de UNA prenda (Postman y versiones anteriores del panel). También
// genera su comprobante de entrada (sin proveedor) y responde la fila creada más `comprobante`.
exports.create = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.id_producto || !body.id_sucursal || body.cantidad === undefined) {
      return res.status(400).send({ message: "El id_producto, id_sucursal y cantidad son obligatorios." });
    }
    if (!esEnteroPositivo(body.id_sucursal)) return res.status(400).send({ message: "La sucursal no es válida." });
    if (!enAlcance(req, body.id_sucursal)) {
      return res.status(403).send({ message: "Solo puedes ingresar stock en tu sucursal." });
    }
    const { linea, error } = leerLineaIngreso(body, 0);
    if (error) return res.status(400).send({ message: error.charAt(0).toUpperCase() + error.slice(1) });
    const malValor = errorDeValor([linea]);
    if (malValor) return res.status(400).send({ message: malValor });
    const r = await registrarIngreso(req, { id_sucursal: Number(body.id_sucursal), lineas: [linea] });
    if (r.status !== 201) return res.status(r.status).send({ message: r.message });
    const c = r.comprobante;
    res.status(201).send({ ...r.filas[0].toJSON(), comprobante: { id_comprobante: c.id_comprobante, folio: c.get("folio") } });
  } catch (err) {
    error500(res, err, "Error al registrar el inventario.");
  }
};

// POST /api/inventario/ingresos — ingreso de mercadería con varias prendas, de un proveedor o directo.
// Body: { id_sucursal, id_proveedor?, documento_proveedor?, observacion?,
//         lineas: [{ id_producto, cantidad, estado?, lote?, costo_unitario? }] }
// Responde 201 { message, comprobante } con el comprobante de entrada completo.
exports.ingresar = async (req, res) => {
  try {
    const body = req.body || {};
    if (!esEnteroPositivo(body.id_sucursal)) return res.status(400).send({ message: "Indica la sucursal que recibe la mercadería." });
    if (!enAlcance(req, body.id_sucursal)) return res.status(403).send({ message: "Solo puedes ingresar stock en tu sucursal." });
    let id_proveedor = null;
    if (body.id_proveedor !== undefined && body.id_proveedor !== null && body.id_proveedor !== "") {
      if (!esEnteroPositivo(body.id_proveedor)) return res.status(400).send({ message: "El proveedor no es válido." });
      id_proveedor = Number(body.id_proveedor);
    }
    const documento = texto(body.documento_proveedor, 61);
    if (documento.length > 60) return res.status(400).send({ message: "El número de documento del proveedor no puede superar los 60 caracteres." });
    if (documento && !id_proveedor) return res.status(400).send({ message: "El número de factura o envío solo aplica a un ingreso de proveedor: elige el proveedor." });
    const observacion = texto(body.observacion, 201);
    if (observacion.length > 200) return res.status(400).send({ message: "La observación no puede superar los 200 caracteres." });

    const recibidas = Array.isArray(body.lineas) ? body.lineas : [];
    if (!recibidas.length) return res.status(400).send({ message: "Agrega al menos una prenda al ingreso." });
    if (recibidas.length > MAX_LINEAS_INGRESO) return res.status(400).send({ message: `Un ingreso admite como máximo ${MAX_LINEAS_INGRESO} líneas.` });
    const lineas = [];
    for (let i = 0; i < recibidas.length; i++) {
      const { linea, error } = leerLineaIngreso(recibidas[i], i + 1);
      if (error) return res.status(400).send({ message: error });
      lineas.push(linea);
    }
    const malValor = errorDeValor(lineas);
    if (malValor) return res.status(400).send({ message: malValor });

    const r = await registrarIngreso(req, { id_sucursal: Number(body.id_sucursal), id_proveedor, documento_proveedor: documento || null, observacion: observacion || null, lineas });
    if (r.status !== 201) return res.status(r.status).send({ message: r.message });
    const comprobante = await require("./comprobante.controller").cargarComprobante(r.comprobante.id_comprobante);
    res.status(201).send({ message: `Ingreso registrado con el comprobante de entrada ${comprobante.folio}.`, comprobante });
  } catch (err) {
    error500(res, err, "Error al registrar el ingreso de mercadería.");
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
    // Fuera del DISTRITAL, solo el inventario de la propia sucursal.
    Object.assign(where, whereSucursal(req));
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
    if (!enAlcance(req, body.id_sucursal)) return res.status(403).send({ message: "Solo puedes ajustar el stock de tu sucursal." });
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

      const motivoTexto = `${MOTIVOS_AJUSTE[motivo]}${observacion ? `. ${observacion}` : ""}`;
      // Comprobante de salida de la baja (antes de tocar las filas: lleva su estado y lote).
      const { emitirComprobante } = require("../utils/comprobantes");
      const comprobante = await emitirComprobante({
        tipo: "SALIDA", concepto: "BAJA", id_sucursal: sucursal.id_sucursal, id_empleado: req.empleadoId,
        motivo: `Baja de stock: ${motivoTexto}`,
        lineas: filas.map((f) => ({ id_producto: f.id_producto, cantidad: porId.get(f.id_inventario).actual - porId.get(f.id_inventario).nueva, estado_inventario: f.estado, lote: f.lote }))
      }, t);
      const texto = `Ajuste de inventario (${comprobante.get("folio")}): ${motivoTexto}`.slice(0, 255);
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
        detalles: `${comprobante.get("folio")}: baja de ${unidades} u. en ${filas.length} fila(s) de la sucursal #${sucursal.id_sucursal} (${MOTIVOS_AJUSTE[motivo]}). Filas: ${filas.map((f) => "#" + f.id_inventario).join(", ")}`.slice(0, 255)
      }, t);
      return {
        status: 200, message: `Stock ajustado: se dieron de baja ${unidades} unidad(es) en ${filas.length} fila(s). Comprobante de salida ${comprobante.get("folio")}.`,
        unidades, filas, comprobante: { id_comprobante: comprobante.id_comprobante, folio: comprobante.get("folio") }
      };
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
        estado: 'DISPONIBLE',
        ...whereSucursal(req)
      },
      group: ['id_producto', 'id_sucursal']
    });

    res.status(200).send(stockGlobal);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al calcular el stock global." });
  }
};
