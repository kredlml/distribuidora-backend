const db = require("../models");
const Devolucion = db.devolucion;
const DetalleDevolucion = db.detalle_devolucion;
const DetallePedido = db.detalle_pedido;
const Pedido = db.pedido;
const Producto = db.producto;
const Inventario = db.inventario;
const MovimientoInventario = db.movimiento_inventario;
const Op = db.Sequelize.Op;
const { ESTADOS, validarTransicion, esEstadoFinal } = require("../utils/estadosDevolucion");
const { registrarAuditoria } = require("../utils/auditoria");
const { whereSucursal } = require("../utils/alcance");
const { crearReembolsosDeDevolucion, procesarEnStripe } = require("../utils/reembolsos");
const notificaciones = require("../utils/notificaciones");
const { leerPaginacion, pagina, textoBusqueda, idBuscado } = require("../utils/paginacion");
const { esIdValido } = require("../middlewares/validarId");

// Después de confirmar: los reembolsos a tarjeta se piden a Stripe (procesarEnStripe avisa a la
// clienta y nunca lanza) y de los de caja se avisa que están listos. Si Stripe no responde, el
// reembolso queda PENDIENTE y caja puede reintentarlo.
async function tramitarReembolsos(creados, idEmpleado) {
  const finales = [];
  for (const r of creados) {
    if (r.metodo === "STRIPE") {
      const final = (await procesarEnStripe(r.id_reembolso, idEmpleado)) || r;
      finales.push(final);
      // Si Stripe no lo terminó al momento, la clienta sabe que está en proceso.
      if (final.estado === "PENDIENTE") notificaciones.reembolsoCreado(r.id_reembolso);
    } else { finales.push(r); notificaciones.reembolsoCreado(r.id_reembolso); }
  }
  return finales;
}
const textoReembolsos = (rs) => {
  if (!rs.length) return "";
  const q = (n) => `Q${Number(n).toFixed(2)}`;
  const enCaja = { EFECTIVO: "en efectivo", TARJETA: "con reversión en el POS", PAYPAL: "por PayPal" };
  return " " + rs.map((r) => r.metodo === "STRIPE"
    ? (r.estado === "COMPLETADO" ? `Se reembolsaron ${q(r.monto)} a la tarjeta.`
      : r.estado === "FALLIDO" ? `Stripe rechazó el reembolso de ${q(r.monto)}: entrégalo en efectivo.`
      : `Reembolso de ${q(r.monto)} a la tarjeta pendiente en Stripe.`)
    : `Entregar ${q(r.monto)} a la clienta ${enCaja[r.metodo] || ""}.`).join(" ");
};

// Tras el commit nada debe hacer rollback ni responder 500: la devolución ya quedó guardada.
async function responderTrasConfirmar(res, devolucion, mensaje, creados, idEmpleado) {
  let reembolsos = creados;
  try { reembolsos = await tramitarReembolsos(creados, idEmpleado); }
  catch (e) { console.warn(`[devoluciones] ${e.message}`); }
  res.status(200).send({ message: `${mensaje}${textoReembolsos(reembolsos)}`, devolucion, reembolsos });
  notificaciones.devolucionActualizada(devolucion.id_devolucion);
}

// Política de cambios y devoluciones: UNA sola solicitud por pedido (aunque la rechacen), y solo
// dentro de las HORAS_PLAZO horas siguientes a la entrega (Pedido.fecha_entrega).
const { HORAS_PLAZO_DEVOLUCION: HORAS_PLAZO, venceDevolucion: venceEl } = require("../utils/plazos");

// Revisa si el pedido admite hoy una solicitud. Devuelve { permite, motivo, mensaje, vence }.
async function politicaDevolucion(pedido, t) {
  const vence = venceEl(pedido);
  if (pedido.estado !== 'ENTREGADO') {
    return { permite: false, motivo: 'NO_ENTREGADO', vence, mensaje: "Solo se pueden solicitar devoluciones o cambios sobre pedidos ya entregados." };
  }
  const previas = await Devolucion.count({ where: { id_pedido: pedido.id_pedido }, transaction: t });
  if (previas > 0) {
    return { permite: false, motivo: 'YA_SOLICITADO', vence, mensaje: "Este pedido ya tuvo su solicitud de cambio o devolución: solo se permite una por pedido." };
  }
  if (!vence || new Date() > vence) {
    return { permite: false, motivo: 'PLAZO_VENCIDO', vence, mensaje: `El plazo para pedir un cambio o una devolución es de ${HORAS_PLAZO} horas desde la entrega y ya venció.` };
  }
  return { permite: true, motivo: null, vence, mensaje: null };
}

// Registra un movimiento de inventario dentro de una transacción. El historial
// es de solo-creación: este es el único lugar del proyecto donde se debe
// insertar en MovimientoInventario.
async function registrarMovimiento(datos, t) {
  return MovimientoInventario.create({
    id_inventario: datos.id_inventario || null,
    id_producto: datos.id_producto,
    id_pedido: datos.id_pedido || null,
    id_devolucion: datos.id_devolucion || null,
    id_empleado: datos.id_empleado || null,
    tipo_movimiento: datos.tipo_movimiento,
    cantidad: datos.cantidad,
    estado_anterior: datos.estado_anterior || null,
    estado_nuevo: datos.estado_nuevo || null,
    observacion: datos.observacion || null
  }, { transaction: t });
}

// Suma cuánto se ha solicitado devolver/cambiar previamente de un detalle de pedido,
// sin contar solicitudes que ya fueron rechazadas (esas no "consumen" cantidad comprada).
async function cantidadYaSolicitada(id_detalle_pedido, t) {
  const previas = await DetalleDevolucion.findAll({
    where: { id_detalle_pedido },
    include: [{ model: Devolucion, where: { estado: { [Op.notIn]: [ESTADOS.RECHAZADA, ESTADOS.RECHAZADA_EN_REVISION] } } }],
    transaction: t
  });
  return previas.reduce((acc, d) => acc + d.cantidad, 0);
}

// Las variantes de una prenda se agrupan por id_producto_padre (estructura de 2 niveles:
// el producto base tiene id_producto_padre NULL y sus variantes apuntan a él).
// La "raíz" del grupo es el padre o, si el producto no tiene padre, él mismo.
function raizDeGrupo(producto) {
  return Number(producto.id_producto_padre || producto.id_producto);
}

// Busca o crea la fila de Inventario (lote) para un producto+sucursal+estado dados
// y le suma la cantidad indicada. Reutiliza el esquema existente de Inventario
// (campo "estado") en vez de crear una tabla nueva para unidades dañadas/defectuosas.
async function reingresarAInventario({ id_producto, id_sucursal, cantidad, estadoInventario }, t) {
  let fila = await Inventario.findOne({
    where: { id_producto, id_sucursal, estado: estadoInventario },
    transaction: t,
    lock: t.LOCK.UPDATE
  });

  if (fila) {
    fila.cantidad += cantidad;
    await fila.save({ transaction: t });
  } else {
    fila = await Inventario.create({
      id_producto,
      id_sucursal,
      cantidad,
      estado: estadoInventario
    }, { transaction: t });
  }
  return fila;
}

// Detalles ordenados por producto (orden de bloqueo estable).
const porProducto = (detalles) => [...(detalles || [])].sort((a, b) => a.id_producto - b.id_producto || a.id_detalle_devolucion - b.id_detalle_devolucion);

// Bloquea de una vez todas las filas de Inventario de esos productos en la sucursal, en orden
// id_producto, id_inventario: el mismo orden en que las ventas (facturacion.js) bloquean sus lotes.
async function bloquearInventario(ids, id_sucursal, t) {
  const unicos = [...new Set(ids.map(Number))];
  if (!unicos.length) return;
  await Inventario.findAll({
    where: { id_producto: unicos, id_sucursal },
    order: [['id_producto', 'ASC'], ['id_inventario', 'ASC']],
    transaction: t,
    lock: t.LOCK.UPDATE
  });
}

// Descuenta cantidad de las unidades DISPONIBLES de un producto en una sucursal,
// usando el mismo criterio FIFO (por orden de ingreso) que el motor de ventas existente.
async function descontarDisponible({ id_producto, id_sucursal, cantidad }, t) {
  const lotes = await Inventario.findAll({
    where: { id_producto, id_sucursal, estado: 'DISPONIBLE', cantidad: { [Op.gt]: 0 } },
    order: [['id_inventario', 'ASC']],
    transaction: t,
    lock: t.LOCK.UPDATE
  });

  const stockTotal = lotes.reduce((sum, l) => sum + l.cantidad, 0);
  if (stockTotal < cantidad) {
    throw new Error(`No hay disponibilidad suficiente del producto ${id_producto} en la sucursal ${id_sucursal}.`);
  }

  let restante = cantidad;
  for (const lote of lotes) {
    if (restante === 0) break;
    if (lote.cantidad >= restante) {
      lote.cantidad -= restante;
      restante = 0;
    } else {
      restante -= lote.cantidad;
      lote.cantidad = 0;
    }
    await lote.save({ transaction: t });
  }
}

exports.politicaDevolucion = politicaDevolucion;

// Bloquea la devolución (dos empleados que la procesan a la vez se ordenan y el segundo ve el
// estado nuevo) y luego carga sus relaciones. Postgres no admite FOR UPDATE con los LEFT JOIN de
// los include, por eso son dos consultas.
async function devolucionBloqueada(id, t, include = []) {
  const fila = await Devolucion.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
  if (!fila || !include.length) return fila;
  return Devolucion.findByPk(id, { include, transaction: t });
}

// POST /api/devoluciones — el cliente (o quien tome el pedido en tienda) registra la solicitud.
exports.create = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const { id_pedido, id_cliente, tipo, motivo, observacion, detalles } = req.body;

    if (!id_pedido || !id_cliente || !tipo || !motivo || !Array.isArray(detalles) || detalles.length === 0) {
      throw new Error("id_pedido, id_cliente, tipo, motivo y al menos un detalle son obligatorios.");
    }

    // El pedido se bloquea: dos solicitudes simultáneas se ordenan y la segunda ve a la primera.
    const pedido = await Pedido.findByPk(id_pedido, { transaction: t, lock: t.LOCK.UPDATE });
    if (!pedido) {
      throw new Error("El pedido indicado no existe.");
    }
    if (Number(pedido.id_cliente) !== Number(id_cliente)) {
      throw new Error("El pedido no pertenece al cliente indicado.");
    }
    const politica = await politicaDevolucion(pedido, t);
    if (!politica.permite) {
      throw new Error(politica.mensaje);
    }

    const nuevaDevolucion = await Devolucion.create({
      id_pedido,
      id_cliente,
      tipo,
      motivo,
      estado: ESTADOS.SOLICITADA,
      observacion: observacion || null
    }, { transaction: t });

    for (const det of detalles) {
      if (!det.id_detalle_pedido || !det.cantidad || det.cantidad <= 0) {
        throw new Error("Cada detalle requiere id_detalle_pedido y una cantidad mayor a 0.");
      }

      const detallePedido = await DetallePedido.findOne({
        where: { id_detalle_pedido: det.id_detalle_pedido, id_pedido },
        transaction: t
      });
      if (!detallePedido) {
        throw new Error(`El detalle de pedido ${det.id_detalle_pedido} no pertenece a este pedido.`);
      }

      const yaSolicitado = await cantidadYaSolicitada(det.id_detalle_pedido, t);
      if (yaSolicitado + det.cantidad > detallePedido.cantidad) {
        throw new Error(
          `La cantidad a devolver del detalle ${det.id_detalle_pedido} supera lo comprado (comprado: ${detallePedido.cantidad}, ya solicitado: ${yaSolicitado}).`
        );
      }

      let precioNuevo = null;
      if ((tipo === 'CAMBIO_TALLA' || tipo === 'CAMBIO_VARIANTE')) {
        if (!det.id_producto_nuevo) {
          throw new Error("Para un cambio de talla/variante debe indicarse id_producto_nuevo en cada detalle.");
        }
        const productoNuevo = await Producto.findByPk(det.id_producto_nuevo, { transaction: t });
        if (!productoNuevo) {
          throw new Error(`El producto nuevo ${det.id_producto_nuevo} no existe.`);
        }
        if (!productoNuevo.activo) {
          throw new Error(`El producto nuevo ${det.id_producto_nuevo} está inactivo y no puede usarse en un cambio.`);
        }
        if (Number(productoNuevo.id_producto) === Number(detallePedido.id_producto)) {
          throw new Error("El producto nuevo debe ser distinto del producto que se devuelve.");
        }
        const productoOriginal = await Producto.findByPk(detallePedido.id_producto, { transaction: t });
        if (raizDeGrupo(productoOriginal) !== raizDeGrupo(productoNuevo)) {
          throw new Error(
            `El producto nuevo ${det.id_producto_nuevo} no es una variante del producto original ${detallePedido.id_producto} (deben pertenecer al mismo grupo de variantes).`
          );
        }
        // Los cambios nunca cobran diferencia: la variante nueva debe costar igual o menos que lo
        // pagado (si cuesta menos, la diferencia se reembolsa al completar el cambio).
        if (Number(productoNuevo.precio_unitario) > Number(detallePedido.precio_unitario)) {
          throw new Error(
            `La variante nueva cuesta Q${Number(productoNuevo.precio_unitario).toFixed(2)}, más de lo que pagaste (Q${Number(detallePedido.precio_unitario).toFixed(2)}). Elige una de igual o menor precio, o solicita una devolución.`
          );
        }
        precioNuevo = productoNuevo.precio_unitario;
      }

      const detalleDevolucion = await DetalleDevolucion.create({
        id_devolucion: nuevaDevolucion.id_devolucion,
        id_detalle_pedido: det.id_detalle_pedido,
        id_producto: detallePedido.id_producto,
        cantidad: det.cantidad,
        id_producto_nuevo: det.id_producto_nuevo || null,
        precio_unitario_nuevo: precioNuevo,
        resultado_revision: 'PENDIENTE'
      }, { transaction: t });

      await registrarMovimiento({
        id_producto: detallePedido.id_producto,
        id_pedido,
        id_devolucion: nuevaDevolucion.id_devolucion,
        id_empleado: req.empleadoId || null, // empleado que registra la solicitud en mostrador
        tipo_movimiento: 'DEVOLUCION_SOLICITADA',
        cantidad: det.cantidad,
        estado_anterior: null,
        estado_nuevo: ESTADOS.SOLICITADA,
        observacion: motivo
      }, t);

      void detalleDevolucion; // ya persistido; se referencia arriba para claridad de flujo
    }

    await t.commit();
    res.status(201).send({ message: "Solicitud de devolución/cambio registrada.", devolucion: nuevaDevolucion });
    notificaciones.devolucionActualizada(nuevaDevolucion.id_devolucion);
  } catch (error) {
    await t.rollback();
    res.status(400).send({ message: error.message });
  }
};

// GET /api/devoluciones?estado=&tipo=&motivo=&id_pedido=&id_cliente=&desde=&hasta=
// desde/hasta (YYYY-MM-DD) filtran por fecha_solicitud, ambos extremos incluidos.
exports.findAll = async (req, res) => {
  try {
    const { estado, tipo, motivo, id_pedido, id_cliente, desde, hasta } = req.query;
    // Filtros inválidos: 400 claro (no un 500 con el error interno de Postgres).
    const enLista = (v, attr) => !v || (Devolucion.rawAttributes[attr].values || []).includes(v);
    if (!enLista(estado, 'estado') || !enLista(tipo, 'tipo') || !enLista(motivo, 'motivo')) {
      return res.status(400).send({ message: "Filtro inválido (estado, tipo o motivo)." });
    }
    if ((id_pedido && !esIdValido(id_pedido)) || (id_cliente && !esIdValido(id_cliente))) {
      return res.status(400).send({ message: "id_pedido e id_cliente deben ser números válidos." });
    }
    const esDia = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
    if ((desde && !esDia(desde)) || (hasta && !esDia(hasta))) {
      return res.status(400).send({ message: "Las fechas desde/hasta deben tener el formato AAAA-MM-DD." });
    }
    const where = {};
    if (estado) where.estado = estado;
    if (tipo) where.tipo = tipo;
    if (motivo) where.motivo = motivo;
    if (id_pedido) where.id_pedido = id_pedido;
    if (id_cliente) where.id_cliente = id_cliente;
    if (desde || hasta) {
      where.fecha_solicitud = {};
      if (desde) where.fecha_solicitud[Op.gte] = new Date(`${desde}T00:00:00`);
      if (hasta) where.fecha_solicitud[Op.lte] = new Date(`${hasta}T23:59:59.999`);
    }

    // ?q= busca por número de devolución o de pedido, o por nombre de la clienta.
    const pag = leerPaginacion(req.query);
    const like = textoBusqueda(req.query.q), idq = idBuscado(req.query.q);
    if (like) {
      where[Op.and] = [{ [Op.or]: [
        ...(idq ? [{ id_devolucion: idq }, { id_pedido: idq }] : []),
        db.sequelize.where(db.sequelize.fn('concat_ws', ' ', db.sequelize.col('Cliente.nombre'), db.sequelize.col('Cliente.apellido')), { [Op.iLike]: like })
      ] }];
    }

    // Solo devoluciones de pedidos de la propia sucursal (el DISTRITAL, todas).
    const alcance = req.empleado ? whereSucursal(req) : {};
    const consulta = {
      where,
      include: [
        { model: db.cliente, attributes: ['id_cliente', 'nombre', 'apellido'] },
        { model: db.empleado, attributes: ['id_empleado', 'nombre', 'apellido'] },
        ...(Object.keys(alcance).length ? [{ model: Pedido, attributes: [], where: alcance }] : [])
      ],
      order: [['id_devolucion', 'DESC']]
    };
    if (pag) {
      const { rows, count } = await Devolucion.findAndCountAll({ ...consulta, limit: pag.limit, offset: pag.offset, distinct: true });
      return res.send(pagina(rows, count, pag));
    }
    res.send(await Devolucion.findAll(consulta));
  } catch (error) {
    res.status(error.status || 500).send({ message: error.message || "Error al recuperar las devoluciones." });
  }
};

exports.findOne = async (req, res) => {
  try {
    const devolucion = await Devolucion.findByPk(req.params.id, {
      include: [
        { model: Pedido, attributes: ['id_pedido', 'estado', 'id_sucursal', 'id_cliente'] },
        { model: db.cliente, attributes: ['id_cliente', 'nombre', 'apellido', 'email', 'telefono'] },
        { model: db.empleado, attributes: ['id_empleado', 'nombre', 'apellido'] },
        {
          model: DetalleDevolucion,
          include: [
            { model: Producto, attributes: ['nombre', 'talla', 'color'] },
            { model: Producto, as: 'ProductoNuevo', attributes: ['nombre', 'talla', 'color'] }
          ]
        },
        { model: db.reembolso, attributes: ['id_reembolso', 'metodo', 'monto', 'estado', 'fecha_creacion', 'fecha_completado'] }
      ]
    });

    if (!devolucion) {
      return res.status(404).send({ message: `No se encontró la devolución con id=${req.params.id}.` });
    }
    res.send(devolucion);
  } catch (error) {
    res.status(500).send({ message: "Error al recuperar la devolución: " + error.message });
  }
};

// GET /api/devoluciones/pedido/:id_pedido/devolvible
// Para cada línea del pedido informa cuánto se compró, cuánto ya está comprometido en
// devoluciones/cambios vigentes (las rechazadas no cuentan, igual que en la validación de
// create) y cuánto se puede aún solicitar. Si el pedido no está ENTREGADO no se puede
// solicitar nada: permite_devolucion=false y cantidad_devolvible=0 en todas las líneas.
exports.devolvible = async (req, res) => {
  try {
    const pedido = await Pedido.findByPk(req.params.id_pedido, {
      attributes: ['id_pedido', 'id_cliente', 'id_sucursal', 'estado', 'fecha_entrega'],
      include: [{
        model: DetallePedido,
        include: [{ model: Producto, attributes: ['nombre', 'talla', 'color'] }]
      }]
    });
    if (!pedido) {
      return res.status(404).send({ message: `No se encontró el Pedido con id=${req.params.id_pedido}.` });
    }

    const lineas = pedido.DetallePedidos || [];
    const ids = lineas.map(l => l.id_detalle_pedido);

    // Una sola consulta con todas las solicitudes vigentes de estas líneas.
    const previas = ids.length === 0 ? [] : await DetalleDevolucion.findAll({
      where: { id_detalle_pedido: { [Op.in]: ids } },
      include: [{
        model: Devolucion,
        attributes: [],
        where: { estado: { [Op.notIn]: [ESTADOS.RECHAZADA, ESTADOS.RECHAZADA_EN_REVISION] } }
      }]
    });
    const solicitadoPorLinea = {};
    for (const d of previas) {
      solicitadoPorLinea[d.id_detalle_pedido] = (solicitadoPorLinea[d.id_detalle_pedido] || 0) + d.cantidad;
    }

    const politica = await politicaDevolucion(pedido);
    const permite = politica.permite;
    res.send({
      id_pedido: pedido.id_pedido,
      id_cliente: pedido.id_cliente,
      id_sucursal: pedido.id_sucursal,
      estado_pedido: pedido.estado,
      permite_devolucion: permite,
      // Por qué no se permite (NO_ENTREGADO, YA_SOLICITADO, PLAZO_VENCIDO) y hasta cuándo se puede.
      motivo_no_permite: politica.motivo,
      mensaje: politica.mensaje,
      plazo_vence: politica.vence,
      horas_plazo: HORAS_PLAZO,
      detalles: lineas.map(l => {
        const solicitada = solicitadoPorLinea[l.id_detalle_pedido] || 0;
        return {
          id_detalle_pedido: l.id_detalle_pedido,
          id_producto: l.id_producto,
          Producto: l.Producto,
          cantidad_comprada: l.cantidad,
          cantidad_solicitada: solicitada,
          cantidad_devolvible: permite ? Math.max(0, l.cantidad - solicitada) : 0
        };
      })
    });
  } catch (error) {
    res.status(500).send({ message: "Error al calcular las cantidades devolvibles: " + error.message });
  }
};

// GET /api/devoluciones/:id/historial
// Línea de tiempo de una devolución: movimientos de inventario (qué pasó con cada prenda)
// y auditoría (qué decisión tomó cada empleado), ambos en orden cronológico.
exports.historial = async (req, res) => {
  try {
    const id = req.params.id;
    const devolucion = await Devolucion.findByPk(id, {
      include: [
        { model: db.cliente, attributes: ['id_cliente', 'nombre', 'apellido'] },
        { model: db.empleado, attributes: ['id_empleado', 'nombre', 'apellido'] }
      ]
    });
    if (!devolucion) {
      return res.status(404).send({ message: `No se encontró la devolución con id=${id}.` });
    }

    const movimientos = await MovimientoInventario.findAll({
      where: { id_devolucion: id },
      include: [
        { model: Producto, attributes: ['nombre', 'talla', 'color'] },
        { model: db.empleado, attributes: ['id_empleado', 'nombre', 'apellido'] }
      ],
      order: [['id_movimiento', 'ASC']]
    });

    const auditoria = await db.auditoria.findAll({
      where: { tabla_afectada: 'Devolucion', registro_afectado_id: id },
      include: [{ model: db.empleado, attributes: ['id_empleado', 'nombre', 'apellido'] }],
      order: [['id_auditoria', 'ASC']]
    });

    res.send({ devolucion, movimientos, auditoria });
  } catch (error) {
    res.status(500).send({ message: "Error al recuperar el historial de la devolución: " + error.message });
  }
};

// Observación opcional (máx. 255 caracteres) enviada por el empleado en el body de
// una acción de gestión (aprobar, rechazar, recibir, revisar). Queda en la auditoría
// y en el movimiento de inventario; no sobrescribe Devolucion.observacion (motivo original).
function obtenerObservacion(req) {
  const obs = req.body && typeof req.body.observacion === 'string' ? req.body.observacion.trim() : '';
  if (obs.length > 255) {
    throw new Error("La observación no puede superar los 255 caracteres.");
  }
  return obs || null;
}

// Helper genérico de transición simple de estado (sin efectos sobre inventario).
async function transicionSimple(req, res, estadoNuevo) {
  const t = await db.sequelize.transaction();
  try {
    const devolucion = await devolucionBloqueada(req.params.id, t);
    if (!devolucion) {
      throw new Error(`No se encontró la devolución con id=${req.params.id}.`);
    }
    if (esEstadoFinal(devolucion.estado)) {
      throw new Error(`La devolución ya se encuentra en un estado final (${devolucion.estado}) y no puede modificarse.`);
    }
    if (!validarTransicion(devolucion.estado, estadoNuevo)) {
      throw new Error(`Transición inválida: no se puede pasar de ${devolucion.estado} a ${estadoNuevo}.`);
    }

    const observacionGestion = obtenerObservacion(req);
    const estadoAnterior = devolucion.estado;
    devolucion.estado = estadoNuevo;
    devolucion.fecha_actualizacion = new Date();
    if (req.empleadoId) devolucion.id_empleado_gestor = req.empleadoId;
    await devolucion.save({ transaction: t });

    await registrarAuditoria({
      id_empleado: req.empleadoId,
      accion: `DEVOLUCION_${estadoNuevo}`,
      tabla_afectada: 'Devolucion',
      registro_afectado_id: devolucion.id_devolucion,
      detalles: `Devolución #${devolucion.id_devolucion} cambiada de ${estadoAnterior} a ${estadoNuevo}.${observacionGestion ? ' Observación: ' + observacionGestion : ''}`
    }, t);

    await t.commit();
    res.status(200).send({ message: `Devolución actualizada a ${estadoNuevo}.`, estado_anterior: estadoAnterior, devolucion });
    notificaciones.devolucionActualizada(devolucion.id_devolucion);
  } catch (error) {
    await t.rollback();
    res.status(400).send({ message: error.message });
  }
}

// PUT /api/devoluciones/:id/aprobar
exports.aprobar = (req, res) => transicionSimple(req, res, ESTADOS.APROBADA);

// PUT /api/devoluciones/:id/rechazar
exports.rechazar = (req, res) => transicionSimple(req, res, ESTADOS.RECHAZADA);

// PUT /api/devoluciones/:id/recibir — la prenda física llega de vuelta a la sucursal.
exports.recibir = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const devolucion = await devolucionBloqueada(req.params.id, t, [{ model: DetalleDevolucion }]);
    if (!devolucion) throw new Error(`No se encontró la devolución con id=${req.params.id}.`);
    if (!validarTransicion(devolucion.estado, ESTADOS.RECIBIDA)) {
      throw new Error(`Transición inválida: no se puede pasar de ${devolucion.estado} a ${ESTADOS.RECIBIDA}.`);
    }

    const observacionGestion = obtenerObservacion(req);
    for (const detalle of devolucion.DetalleDevolucions) {
      await registrarMovimiento({
        id_producto: detalle.id_producto,
        id_pedido: devolucion.id_pedido,
        id_devolucion: devolucion.id_devolucion,
        id_empleado: req.empleadoId,
        tipo_movimiento: 'DEVOLUCION_RECIBIDA',
        cantidad: detalle.cantidad,
        estado_anterior: devolucion.estado,
        estado_nuevo: ESTADOS.RECIBIDA,
        observacion: observacionGestion
          ? `Prenda recibida físicamente en sucursal. ${observacionGestion}`.slice(0, 255)
          : "Prenda recibida físicamente en sucursal."
      }, t);
    }

    devolucion.estado = ESTADOS.RECIBIDA;
    devolucion.fecha_actualizacion = new Date();
    devolucion.id_empleado_gestor = req.empleadoId;
    await devolucion.save({ transaction: t });

    await registrarAuditoria({
      id_empleado: req.empleadoId,
      accion: 'DEVOLUCION_RECIBIDA',
      tabla_afectada: 'Devolucion',
      registro_afectado_id: devolucion.id_devolucion,
      detalles: `Devolución #${devolucion.id_devolucion} recibida físicamente en sucursal.${observacionGestion ? ' Observación: ' + observacionGestion : ''}`
    }, t);

    await t.commit();
    res.status(200).send({ message: "Devolución marcada como recibida.", devolucion });
    notificaciones.devolucionActualizada(devolucion.id_devolucion);
  } catch (error) {
    await t.rollback();
    res.status(400).send({ message: error.message });
  }
};

// PUT /api/devoluciones/:id/revisar
// Body: { aceptar: boolean, detalles: [{ id_detalle_devolucion, resultado_revision }] }
// resultado_revision ∈ BUEN_ESTADO | DANADO | DEFECTUOSO
exports.revisar = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const { aceptar, detalles } = req.body;
    if (typeof aceptar !== 'boolean' || !Array.isArray(detalles) || detalles.length === 0) {
      throw new Error("Debe indicarse 'aceptar' (boolean) y el resultado de revisión de cada detalle.");
    }

    const devolucion = await devolucionBloqueada(req.params.id, t, [{ model: DetalleDevolucion }]);
    if (!devolucion) throw new Error(`No se encontró la devolución con id=${req.params.id}.`);
    if (!validarTransicion(devolucion.estado, ESTADOS.EN_REVISION)) {
      throw new Error(`Transición inválida: no se puede pasar de ${devolucion.estado} a ${ESTADOS.EN_REVISION}.`);
    }

    // M4: la revisión debe cubrir TODAS las prendas de la devolución, sin repetidas.
    const idsEnviados = detalles.map(d => d.id_detalle_devolucion);
    if (new Set(idsEnviados).size !== idsEnviados.length) {
      throw new Error("La revisión contiene detalles repetidos.");
    }
    const faltantes = devolucion.DetalleDevolucions
      .filter(d => !idsEnviados.includes(d.id_detalle_devolucion))
      .map(d => d.id_detalle_devolucion);
    if (faltantes.length > 0) {
      throw new Error(`La revisión debe incluir todos los detalles de la devolución. Faltan: ${faltantes.join(', ')}.`);
    }
    const observacionGestion = obtenerObservacion(req);

    const estadoFinal = aceptar ? ESTADOS.ACEPTADA : ESTADOS.RECHAZADA_EN_REVISION;
    if (!validarTransicion(ESTADOS.EN_REVISION, estadoFinal)) {
      throw new Error(`Transición inválida: no se puede pasar de ${ESTADOS.EN_REVISION} a ${estadoFinal}.`);
    }

    for (const detEntrada of detalles) {
      const detalle = devolucion.DetalleDevolucions.find(d => d.id_detalle_devolucion === detEntrada.id_detalle_devolucion);
      if (!detalle) {
        throw new Error(`El detalle ${detEntrada.id_detalle_devolucion} no pertenece a esta devolución.`);
      }
      if (!['BUEN_ESTADO', 'DANADO', 'DEFECTUOSO'].includes(detEntrada.resultado_revision)) {
        throw new Error(`resultado_revision inválido para el detalle ${detEntrada.id_detalle_devolucion}.`);
      }

      detalle.resultado_revision = detEntrada.resultado_revision;
      await detalle.save({ transaction: t });

      const tipoMovimiento = detEntrada.resultado_revision === 'DANADO'
        ? 'PRODUCTO_DANADO'
        : detEntrada.resultado_revision === 'DEFECTUOSO'
          ? 'PRODUCTO_DEFECTUOSO'
          : 'EN_REVISION';

      await registrarMovimiento({
        id_producto: detalle.id_producto,
        id_pedido: devolucion.id_pedido,
        id_devolucion: devolucion.id_devolucion,
        id_empleado: req.empleadoId,
        tipo_movimiento: tipoMovimiento,
        cantidad: detalle.cantidad,
        estado_anterior: ESTADOS.RECIBIDA,
        estado_nuevo: estadoFinal,
        observacion: `Resultado de revisión: ${detEntrada.resultado_revision}.${observacionGestion ? ' ' + observacionGestion : ''}`.slice(0, 255)
      }, t);
    }

    devolucion.estado = estadoFinal;
    devolucion.fecha_actualizacion = new Date();
    devolucion.id_empleado_gestor = req.empleadoId;
    await devolucion.save({ transaction: t });

    await registrarAuditoria({
      id_empleado: req.empleadoId,
      accion: `DEVOLUCION_${estadoFinal}`,
      tabla_afectada: 'Devolucion',
      registro_afectado_id: devolucion.id_devolucion,
      detalles: `Devolución #${devolucion.id_devolucion} revisada. Resultado: ${estadoFinal}.${observacionGestion ? ' Observación: ' + observacionGestion : ''}`
    }, t);

    await t.commit();
    res.status(200).send({ message: `Revisión completada. Devolución en estado ${estadoFinal}.`, devolucion });
    notificaciones.devolucionActualizada(devolucion.id_devolucion);
  } catch (error) {
    await t.rollback();
    res.status(400).send({ message: error.message });
  }
};

// PUT /api/devoluciones/:id/reintegrar — solo para tipo=DEVOLUCION, estado ACEPTADA.
exports.reintegrar = async (req, res) => {
  const t = await db.sequelize.transaction();
  let confirmado = false;
  try {
    const devolucion = await devolucionBloqueada(req.params.id, t, [{ model: DetalleDevolucion }, { model: Pedido }]);
    if (!devolucion) throw new Error(`No se encontró la devolución con id=${req.params.id}.`);
    if (devolucion.tipo !== 'DEVOLUCION') {
      throw new Error("Esta operación solo aplica a devoluciones de tipo DEVOLUCION (use /cambiar para cambios de talla/variante).");
    }
    if (!validarTransicion(devolucion.estado, ESTADOS.REINTEGRADA)) {
      throw new Error(`Transición inválida: no se puede pasar de ${devolucion.estado} a ${ESTADOS.REINTEGRADA}.`);
    }

    const id_sucursal = devolucion.Pedido.id_sucursal;
    const detalles = porProducto(devolucion.DetalleDevolucions);
    await bloquearInventario(detalles.map(d => d.id_producto), id_sucursal, t);

    for (const detalle of detalles) {
      if (detalle.resultado_revision === 'PENDIENTE') {
        throw new Error(`El detalle ${detalle.id_detalle_devolucion} aún no tiene resultado de revisión.`);
      }

      const estadoInventario = detalle.resultado_revision === 'BUEN_ESTADO'
        ? 'DISPONIBLE'
        : detalle.resultado_revision === 'DANADO' ? 'DANADA' : 'DEFECTUOSA';

      const fila = await reingresarAInventario({
        id_producto: detalle.id_producto,
        id_sucursal,
        cantidad: detalle.cantidad,
        estadoInventario
      }, t);

      await registrarMovimiento({
        id_inventario: fila.id_inventario,
        id_producto: detalle.id_producto,
        id_pedido: devolucion.id_pedido,
        id_devolucion: devolucion.id_devolucion,
        id_empleado: req.empleadoId,
        tipo_movimiento: 'REINTEGRACION',
        cantidad: detalle.cantidad,
        estado_anterior: detalle.resultado_revision,
        estado_nuevo: estadoInventario,
        observacion: estadoInventario === 'DISPONIBLE'
          ? "Reintegrado a stock disponible para venta."
          : `Reintegrado como ${estadoInventario}, no disponible para venta.`
      }, t);
    }

    devolucion.estado = ESTADOS.REINTEGRADA;
    devolucion.fecha_actualizacion = new Date();
    devolucion.id_empleado_gestor = req.empleadoId;
    await devolucion.save({ transaction: t });

    await registrarAuditoria({
      id_empleado: req.empleadoId,
      accion: 'DEVOLUCION_REINTEGRADA',
      tabla_afectada: 'Devolucion',
      registro_afectado_id: devolucion.id_devolucion,
      detalles: `Devolución #${devolucion.id_devolucion} reintegrada al inventario de la sucursal ${id_sucursal}.`
    }, t);

    // El dinero de las prendas devueltas: a la tarjeta en línea (Stripe) y/o pendiente en caja.
    const creados = await crearReembolsosDeDevolucion({ devolucion, pedido: devolucion.Pedido, id_empleado: req.empleadoId }, t);

    await t.commit();
    confirmado = true;
    await responderTrasConfirmar(res, devolucion, "Devolución reintegrada al inventario.", creados, req.empleadoId);
  } catch (error) {
    if (confirmado) return console.warn(`[devoluciones] Tras reintegrar #${req.params.id}: ${error.message}`);
    await t.rollback().catch(() => {});
    res.status(400).send({ message: error.message });
  }
};

// PUT /api/devoluciones/:id/cambiar — solo para tipo=CAMBIO_TALLA / CAMBIO_VARIANTE, estado ACEPTADA.
exports.cambiar = async (req, res) => {
  const t = await db.sequelize.transaction();
  let confirmado = false;
  try {
    const devolucion = await devolucionBloqueada(req.params.id, t, [{ model: DetalleDevolucion }, { model: Pedido }]);
    if (!devolucion) throw new Error(`No se encontró la devolución con id=${req.params.id}.`);
    if (!['CAMBIO_TALLA', 'CAMBIO_VARIANTE'].includes(devolucion.tipo)) {
      throw new Error("Esta operación solo aplica a devoluciones de tipo CAMBIO_TALLA o CAMBIO_VARIANTE.");
    }
    if (!validarTransicion(devolucion.estado, ESTADOS.CAMBIADA)) {
      throw new Error(`Transición inválida: no se puede pasar de ${devolucion.estado} a ${ESTADOS.CAMBIADA}.`);
    }

    const id_sucursal = devolucion.Pedido.id_sucursal;
    const detalles = porProducto(devolucion.DetalleDevolucions);
    // Todas las filas que se tocarán (prendas devueltas y variantes nuevas) se bloquean primero, en
    // el mismo orden que las ventas: así la validación de stock es firme y no hay deadlocks.
    await bloquearInventario(detalles.flatMap(d => [d.id_producto, d.id_producto_nuevo]).filter(Boolean), id_sucursal, t);

    // 1) Validar disponibilidad de TODAS las variantes nuevas antes de mover cualquier stock,
    //    para no dejar el inventario a medio actualizar si una variante no alcanza.
    for (const detalle of detalles) {
      if (!detalle.id_producto_nuevo) {
        throw new Error(`El detalle ${detalle.id_detalle_devolucion} no tiene producto nuevo asignado.`);
      }
      const stockNuevo = await Inventario.sum('cantidad', {
        where: { id_producto: detalle.id_producto_nuevo, id_sucursal, estado: 'DISPONIBLE' },
        transaction: t
      }) || 0;
      if (stockNuevo < detalle.cantidad) {
        throw new Error(`No hay disponibilidad de la nueva variante (producto ${detalle.id_producto_nuevo}) en la sucursal ${id_sucursal}.`);
      }
    }

    // 2) Ejecutar el cambio: sale la prenda vieja (según su condición) y entra la nueva variante.
    for (const detalle of detalles) {
      const estadoInventarioVieja = detalle.resultado_revision === 'BUEN_ESTADO'
        ? 'DISPONIBLE'
        : detalle.resultado_revision === 'DANADO' ? 'DANADA' : 'DEFECTUOSA';

      const filaVieja = await reingresarAInventario({
        id_producto: detalle.id_producto,
        id_sucursal,
        cantidad: detalle.cantidad,
        estadoInventario: estadoInventarioVieja
      }, t);

      await registrarMovimiento({
        id_inventario: filaVieja.id_inventario,
        id_producto: detalle.id_producto,
        id_pedido: devolucion.id_pedido,
        id_devolucion: devolucion.id_devolucion,
        id_empleado: req.empleadoId,
        tipo_movimiento: 'CAMBIO_SALIDA',
        cantidad: detalle.cantidad,
        estado_anterior: detalle.resultado_revision,
        estado_nuevo: estadoInventarioVieja,
        observacion: "Variante original devuelta como parte de un cambio."
      }, t);

      await descontarDisponible({
        id_producto: detalle.id_producto_nuevo,
        id_sucursal,
        cantidad: detalle.cantidad
      }, t);

      await registrarMovimiento({
        id_producto: detalle.id_producto_nuevo,
        id_pedido: devolucion.id_pedido,
        id_devolucion: devolucion.id_devolucion,
        id_empleado: req.empleadoId,
        tipo_movimiento: 'CAMBIO_ENTRADA',
        cantidad: detalle.cantidad,
        estado_anterior: 'DISPONIBLE',
        estado_nuevo: 'DISPONIBLE',
        observacion: `Nueva variante entregada al cliente por cambio de la devolución #${devolucion.id_devolucion}.`
      }, t);
    }

    devolucion.estado = ESTADOS.CAMBIADA;
    devolucion.fecha_actualizacion = new Date();
    devolucion.id_empleado_gestor = req.empleadoId;
    await devolucion.save({ transaction: t });

    await registrarAuditoria({
      id_empleado: req.empleadoId,
      accion: 'DEVOLUCION_CAMBIADA',
      tabla_afectada: 'Devolucion',
      registro_afectado_id: devolucion.id_devolucion,
      detalles: `Devolución #${devolucion.id_devolucion} procesada como cambio de variante en la sucursal ${id_sucursal}.`
    }, t);

    // Si la variante nueva cuesta menos, se devuelve la diferencia.
    const creados = await crearReembolsosDeDevolucion({ devolucion, pedido: devolucion.Pedido, id_empleado: req.empleadoId }, t);

    await t.commit();
    confirmado = true;
    await responderTrasConfirmar(res, devolucion, "Cambio de variante procesado correctamente.", creados, req.empleadoId);
  } catch (error) {
    if (confirmado) return console.warn(`[devoluciones] Tras cambiar #${req.params.id}: ${error.message}`);
    await t.rollback().catch(() => {});
    res.status(400).send({ message: error.message });
  }
};
