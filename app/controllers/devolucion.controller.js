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

// Descuenta cantidad de las unidades DISPONIBLES de un producto en una sucursal,
// usando el mismo criterio FIFO (por fecha de caducidad) que el motor de ventas existente.
async function descontarDisponible({ id_producto, id_sucursal, cantidad }, t) {
  const lotes = await Inventario.findAll({
    where: { id_producto, id_sucursal, estado: 'DISPONIBLE', cantidad: { [Op.gt]: 0 } },
    order: [['fecha_caducidad', 'ASC']],
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

// POST /api/devoluciones — el cliente (o quien tome el pedido en tienda) registra la solicitud.
exports.create = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const { id_pedido, id_cliente, tipo, motivo, observacion, detalles } = req.body;

    if (!id_pedido || !id_cliente || !tipo || !motivo || !Array.isArray(detalles) || detalles.length === 0) {
      throw new Error("id_pedido, id_cliente, tipo, motivo y al menos un detalle son obligatorios.");
    }

    const pedido = await Pedido.findByPk(id_pedido, { transaction: t });
    if (!pedido) {
      throw new Error("El pedido indicado no existe.");
    }
    if (Number(pedido.id_cliente) !== Number(id_cliente)) {
      throw new Error("El pedido no pertenece al cliente indicado.");
    }
    if (pedido.estado !== 'ENTREGADO') {
      throw new Error("Solo se pueden solicitar devoluciones o cambios sobre pedidos ya entregados.");
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

      if ((tipo === 'CAMBIO_TALLA' || tipo === 'CAMBIO_VARIANTE')) {
        if (!det.id_producto_nuevo) {
          throw new Error("Para un cambio de talla/variante debe indicarse id_producto_nuevo en cada detalle.");
        }
        const productoNuevo = await Producto.findByPk(det.id_producto_nuevo, { transaction: t });
        if (!productoNuevo) {
          throw new Error(`El producto nuevo ${det.id_producto_nuevo} no existe.`);
        }
      }

      const detalleDevolucion = await DetalleDevolucion.create({
        id_devolucion: nuevaDevolucion.id_devolucion,
        id_detalle_pedido: det.id_detalle_pedido,
        id_producto: detallePedido.id_producto,
        cantidad: det.cantidad,
        id_producto_nuevo: det.id_producto_nuevo || null,
        resultado_revision: 'PENDIENTE'
      }, { transaction: t });

      await registrarMovimiento({
        id_producto: detallePedido.id_producto,
        id_pedido,
        id_devolucion: nuevaDevolucion.id_devolucion,
        id_empleado: null, // solicitud iniciada por el cliente, no por un empleado autenticado
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
  } catch (error) {
    await t.rollback();
    res.status(400).send({ message: error.message });
  }
};

exports.findAll = async (req, res) => {
  try {
    const data = await Devolucion.findAll({ order: [['id_devolucion', 'DESC']] });
    res.send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al recuperar las devoluciones." });
  }
};

exports.findOne = async (req, res) => {
  try {
    const devolucion = await Devolucion.findByPk(req.params.id, {
      include: [
        { model: Pedido, attributes: ['id_pedido', 'estado', 'id_sucursal', 'id_cliente'] },
        {
          model: DetalleDevolucion,
          include: [
            { model: Producto, attributes: ['nombre', 'talla', 'color'] },
            { model: Producto, as: 'ProductoNuevo', attributes: ['nombre', 'talla', 'color'] }
          ]
        }
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

// Helper genérico de transición simple de estado (sin efectos sobre inventario).
async function transicionSimple(req, res, estadoNuevo) {
  const t = await db.sequelize.transaction();
  try {
    const devolucion = await Devolucion.findByPk(req.params.id, { transaction: t });
    if (!devolucion) {
      throw new Error(`No se encontró la devolución con id=${req.params.id}.`);
    }
    if (esEstadoFinal(devolucion.estado)) {
      throw new Error(`La devolución ya se encuentra en un estado final (${devolucion.estado}) y no puede modificarse.`);
    }
    if (!validarTransicion(devolucion.estado, estadoNuevo)) {
      throw new Error(`Transición inválida: no se puede pasar de ${devolucion.estado} a ${estadoNuevo}.`);
    }

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
      detalles: `Devolución #${devolucion.id_devolucion} cambiada de ${estadoAnterior} a ${estadoNuevo}.`
    }, t);

    await t.commit();
    res.status(200).send({ message: `Devolución actualizada a ${estadoNuevo}.`, estado_anterior: estadoAnterior, devolucion });
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
    const devolucion = await Devolucion.findByPk(req.params.id, {
      include: [{ model: DetalleDevolucion }],
      transaction: t
    });
    if (!devolucion) throw new Error(`No se encontró la devolución con id=${req.params.id}.`);
    if (!validarTransicion(devolucion.estado, ESTADOS.RECIBIDA)) {
      throw new Error(`Transición inválida: no se puede pasar de ${devolucion.estado} a ${ESTADOS.RECIBIDA}.`);
    }

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
        observacion: "Prenda recibida físicamente en sucursal."
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
      detalles: `Devolución #${devolucion.id_devolucion} recibida físicamente en sucursal.`
    }, t);

    await t.commit();
    res.status(200).send({ message: "Devolución marcada como recibida.", devolucion });
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

    const devolucion = await Devolucion.findByPk(req.params.id, {
      include: [{ model: DetalleDevolucion }],
      transaction: t
    });
    if (!devolucion) throw new Error(`No se encontró la devolución con id=${req.params.id}.`);
    if (!validarTransicion(devolucion.estado, ESTADOS.EN_REVISION)) {
      throw new Error(`Transición inválida: no se puede pasar de ${devolucion.estado} a ${ESTADOS.EN_REVISION}.`);
    }

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
        observacion: `Resultado de revisión: ${detEntrada.resultado_revision}.`
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
      detalles: `Devolución #${devolucion.id_devolucion} revisada. Resultado: ${estadoFinal}.`
    }, t);

    await t.commit();
    res.status(200).send({ message: `Revisión completada. Devolución en estado ${estadoFinal}.`, devolucion });
  } catch (error) {
    await t.rollback();
    res.status(400).send({ message: error.message });
  }
};

// PUT /api/devoluciones/:id/reintegrar — solo para tipo=DEVOLUCION, estado ACEPTADA.
exports.reintegrar = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const devolucion = await Devolucion.findByPk(req.params.id, {
      include: [{ model: DetalleDevolucion }, { model: Pedido }],
      transaction: t
    });
    if (!devolucion) throw new Error(`No se encontró la devolución con id=${req.params.id}.`);
    if (devolucion.tipo !== 'DEVOLUCION') {
      throw new Error("Esta operación solo aplica a devoluciones de tipo DEVOLUCION (use /cambiar para cambios de talla/variante).");
    }
    if (!validarTransicion(devolucion.estado, ESTADOS.REINTEGRADA)) {
      throw new Error(`Transición inválida: no se puede pasar de ${devolucion.estado} a ${ESTADOS.REINTEGRADA}.`);
    }

    const id_sucursal = devolucion.Pedido.id_sucursal;

    for (const detalle of devolucion.DetalleDevolucions) {
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

    await t.commit();
    res.status(200).send({ message: "Devolución reintegrada al inventario.", devolucion });
  } catch (error) {
    await t.rollback();
    res.status(400).send({ message: error.message });
  }
};

// PUT /api/devoluciones/:id/cambiar — solo para tipo=CAMBIO_TALLA / CAMBIO_VARIANTE, estado ACEPTADA.
exports.cambiar = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const devolucion = await Devolucion.findByPk(req.params.id, {
      include: [{ model: DetalleDevolucion }, { model: Pedido }],
      transaction: t
    });
    if (!devolucion) throw new Error(`No se encontró la devolución con id=${req.params.id}.`);
    if (!['CAMBIO_TALLA', 'CAMBIO_VARIANTE'].includes(devolucion.tipo)) {
      throw new Error("Esta operación solo aplica a devoluciones de tipo CAMBIO_TALLA o CAMBIO_VARIANTE.");
    }
    if (!validarTransicion(devolucion.estado, ESTADOS.CAMBIADA)) {
      throw new Error(`Transición inválida: no se puede pasar de ${devolucion.estado} a ${ESTADOS.CAMBIADA}.`);
    }

    const id_sucursal = devolucion.Pedido.id_sucursal;

    // 1) Validar disponibilidad de TODAS las variantes nuevas antes de mover cualquier stock,
    //    para no dejar el inventario a medio actualizar si una variante no alcanza.
    for (const detalle of devolucion.DetalleDevolucions) {
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
    for (const detalle of devolucion.DetalleDevolucions) {
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

    await t.commit();
    res.status(200).send({ message: "Cambio de variante procesado correctamente.", devolucion });
  } catch (error) {
    await t.rollback();
    res.status(400).send({ message: error.message });
  }
};
