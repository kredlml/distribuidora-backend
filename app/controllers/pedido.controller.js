const db = require("../models");
const Pedido = db.pedido;
const DetallePedido = db.detalle_pedido;
const Cliente = db.cliente;
const Sucursal = db.sucursal;
const Producto = db.producto;
const Pago = db.pago;
const { registrarAuditoria } = require("../utils/auditoria");
const {
  errorHttp,
  validarCantidad,
  obtenerProductoVendible,
  descontarStockVenta,
  reintegrarStockVenta,
  totalPagado
} = require("../utils/facturacion");

const ESTADOS_PEDIDO_VALIDOS = ['PENDIENTE', 'PROCESADO', 'ENVIADO', 'ENTREGADO', 'CANCELADO'];

// POST /api/pedidos — registra una venta.
// Body: { id_cliente, id_sucursal, detalles: [{ id_producto, cantidad }] }
// (también acepta una sola línea con id_producto/cantidad en la raíz del body).
// Todo pedido nace PENDIENTE de pago; el precio sale del catálogo y el total lo
// calculan los hooks de DetallePedido, por eso se ignoran estado/total/precio del body.
exports.create = async (req, res) => {

  const t = await db.sequelize.transaction();

  try {
    const body = req.body || {};
    const { id_cliente, id_sucursal } = body;
    const lineasRecibidas = Array.isArray(body.detalles) && body.detalles.length > 0
      ? body.detalles
      : [{ id_producto: body.id_producto, cantidad: body.cantidad }];

    if (!id_cliente || !id_sucursal || lineasRecibidas.some(l => !l || !l.id_producto || !l.cantidad)) {
      throw errorHttp(400, "Faltan datos obligatorios para procesar la venta.");
    }

    // Una línea por producto (se suman las repetidas) y en orden de id_producto: así todas
    // las ventas bloquean el inventario en el mismo orden y no se producen deadlocks.
    const porProducto = new Map();
    for (const l of lineasRecibidas) {
      const id = Number(l.id_producto);
      porProducto.set(id, (porProducto.get(id) || 0) + validarCantidad(l.cantidad));
    }
    const lineas = [...porProducto.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id_producto, cantidad]) => ({ id_producto, cantidad }));
    const cantidades = lineas.map(l => l.cantidad);

    const cliente = await Cliente.findByPk(id_cliente, { transaction: t });
    if (!cliente || !cliente.activo) {
      throw errorHttp(400, `El cliente ${id_cliente} no existe o está inactivo.`);
    }
    const sucursal = await Sucursal.findByPk(id_sucursal, { transaction: t });
    if (!sucursal || !sucursal.activo) {
      throw errorHttp(400, `La sucursal ${id_sucursal} no existe o está inactiva.`);
    }

    const pedidoCreado = await Pedido.create({
      estado: 'PENDIENTE',
      total: 0,
      id_cliente,
      id_sucursal,
      id_empleado: req.empleadoId
    }, { transaction: t });

    for (let i = 0; i < lineas.length; i++) {
      const producto = await obtenerProductoVendible(lineas[i].id_producto, t);

      await descontarStockVenta({
        id_producto: producto.id_producto,
        id_sucursal,
        cantidad: cantidades[i],
        id_pedido: pedidoCreado.id_pedido,
        id_empleado: req.empleadoId
      }, t);

      // subtotal y Pedido.total los calculan los hooks del modelo DetallePedido.
      await DetallePedido.create({
        cantidad: cantidades[i],
        precio_unitario: producto.precio_unitario,
        id_pedido: pedidoCreado.id_pedido,
        id_producto: producto.id_producto
      }, { transaction: t });
    }

    // El hook actualizó la fila en BD; se recarga para responder con el total real.
    await pedidoCreado.reload({ transaction: t });

    await registrarAuditoria({
      id_empleado: req.empleadoId,
      accion: 'PEDIDO_CREADO',
      tabla_afectada: 'Pedido',
      registro_afectado_id: pedidoCreado.id_pedido,
      detalles: `Pedido #${pedidoCreado.id_pedido} creado con ${lineas.length} línea(s) por un total de ${Number(pedidoCreado.total).toFixed(2)}.`
    }, t);

    await t.commit();
    res.status(201).send({
      message: "Venta procesada exitosamente",
      pedido: pedidoCreado
    });

  } catch (error) {

    await t.rollback();
    res.status(error.status || 400).send({ message: error.message });
  }
};


// GET /api/pedidos?estado=&id_cliente=&id_sucursal=&desde=&hasta=
// desde/hasta (YYYY-MM-DD) filtran por fecha_pedido, ambos extremos incluidos.
// Ej.: pedidos entregados de un cliente (candidatos a devolución):
//      /api/pedidos?id_cliente=3&estado=ENTREGADO
exports.findAll = async (req, res) => {
  try {
    const Op = db.Sequelize.Op;
    const { estado, id_cliente, id_sucursal, desde, hasta } = req.query;
    const where = {};
    if (estado) {
      if (!ESTADOS_PEDIDO_VALIDOS.includes(estado)) {
        return res.status(400).send({ message: `Estado inválido. Valores permitidos: ${ESTADOS_PEDIDO_VALIDOS.join(', ')}.` });
      }
      where.estado = estado;
    }
    if (id_cliente) where.id_cliente = id_cliente;
    if (id_sucursal) where.id_sucursal = id_sucursal;
    if (desde || hasta) {
      where.fecha_pedido = {};
      if (desde) where.fecha_pedido[Op.gte] = new Date(`${desde}T00:00:00`);
      if (hasta) where.fecha_pedido[Op.lte] = new Date(`${hasta}T23:59:59.999`);
    }

    const data = await Pedido.findAll({
      where,
      include: [{ model: Cliente, attributes: ['id_cliente', 'nombre', 'apellido'] }],
      order: [['id_pedido', 'DESC']]
    });
    res.send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al recuperar los pedidos." });
  }
};

exports.findOne = async (req, res) => {
  try {
    const id = req.params.id;

    const pedido = await Pedido.findByPk(id, {
      include: [
        { 
          model: Cliente, 
          attributes: ['nombre', 'apellido', 'email', 'telefono'] 
        },
        { 
          model: Sucursal, 
          attributes: ['nombre', 'ciudad'] 
        },
        { 
          model: db.detalle_pedido, // Usamos la variable exacta de tu index.js
          include: [{ 
            model: Producto, 
            attributes: ['nombre', 'talla', 'precio_unitario'] 
          }]
        },
        { 
          model: Pago, 
          attributes: ['monto', 'metodo_pago', 'estado_pago', 'fecha_pago'] 
        }
      ]
    });

    if (pedido) {
      res.status(200).send(pedido);
    } else {
      res.status(404).send({ message: `No se encontró el Pedido con id=${id}.` });
    }
  } catch (error) {
    res.status(500).send({ message: "Error al recuperar el Pedido: " + error.message });
  }
};

// Máquina de estados del pedido. Devuelve null si la transición es válida o el motivo
// del rechazo si no lo es. Flujo permitido:
//   PENDIENTE (de pago) -> PROCESADO (pagado) -> ENVIADO -> ENTREGADO
//   PENDIENTE -> CANCELADO
// ENTREGADO y CANCELADO son finales; lo posterior a la entrega se gestiona como devolución.
function validarTransicionPedido(estadoActual, estadoNuevo) {
  if (estadoActual === estadoNuevo) {
    return `El pedido ya se encuentra en estado ${estadoActual}.`;
  }
  if (estadoActual === 'CANCELADO') {
    return "No se puede modificar un pedido ya cancelado.";
  }
  if (estadoActual === 'ENTREGADO') {
    return "El pedido ya fue ENTREGADO y no admite más cambios de estado; los cambios posteriores se gestionan como devolución.";
  }
  if (estadoNuevo === 'PENDIENTE') {
    return "Un pedido no puede regresar al estado PENDIENTE.";
  }

  if (estadoActual === 'PENDIENTE') {
    if (estadoNuevo === 'ENTREGADO') {
      return "No se puede marcar como ENTREGADO un pedido que sigue PENDIENTE de pago.";
    }
    if (estadoNuevo === 'ENVIADO') {
      return "No se puede marcar como ENVIADO un pedido que sigue PENDIENTE de pago.";
    }
    return null; // PROCESADO (si el pago lo cubre) o CANCELADO
  }

  if (estadoActual === 'PROCESADO') {
    if (estadoNuevo === 'ENTREGADO') {
      return "El pedido debe pasar por ENVIADO antes de marcarse como ENTREGADO.";
    }
    if (estadoNuevo === 'CANCELADO') {
      return "El pedido ya fue pagado (PROCESADO) y no puede cancelarse sin gestionar antes el reembolso.";
    }
    return null; // ENVIADO
  }

  if (estadoActual === 'ENVIADO') {
    if (estadoNuevo === 'ENTREGADO') {
      return null;
    }
    return "Un pedido ENVIADO solo puede pasar a ENTREGADO.";
  }

  return `Transición inválida: no se puede pasar de ${estadoActual} a ${estadoNuevo}.`;
}

// Puestos que pueden llevar un pedido a cada estado: el cobro y la cancelación son de caja;
// el despacho y la entrega, de bodega. ADMIN puede todo.
const PUESTOS_POR_ESTADO = {
  PROCESADO: ['ADMIN', 'CAJERO'],
  CANCELADO: ['ADMIN', 'CAJERO'],
  ENVIADO: ['ADMIN', 'BODEGUERO'],
  ENTREGADO: ['ADMIN', 'BODEGUERO']
};

// PUT /api/pedidos/:id/estado — avanza el estado del pedido según la máquina de estados.
// ENTREGADO es la precondición para poder solicitar devoluciones/cambios sobre el pedido.
exports.actualizarEstado = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const id = req.params.id;
    const { estado } = req.body || {};

    if (!estado || !ESTADOS_PEDIDO_VALIDOS.includes(estado)) {
      throw errorHttp(400, `El estado debe ser uno de: ${ESTADOS_PEDIDO_VALIDOS.join(', ')}.`);
    }

    const empleado = await db.empleado.findByPk(req.empleadoId, { transaction: t });
    const puesto = empleado && empleado.puesto ? empleado.puesto.trim().toUpperCase() : '';
    const permitidos = PUESTOS_POR_ESTADO[estado] || ['ADMIN'];
    if (!permitidos.includes(puesto)) {
      throw errorHttp(403, `¡Acceso denegado! Solo ${permitidos.join(' o ')} pueden marcar un pedido como ${estado}.`);
    }

    // Se bloquea la fila para que dos peticiones simultáneas no apliquen transiciones a la vez.
    const pedido = await Pedido.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!pedido) {
      throw errorHttp(404, `No se encontró el Pedido con id=${id}.`);
    }

    const motivoRechazo = validarTransicionPedido(pedido.estado, estado);
    if (motivoRechazo) {
      throw errorHttp(400, motivoRechazo);
    }

    // PENDIENTE -> PROCESADO solo si los pagos COMPLETADOS cubren el total.
    if (estado === 'PROCESADO') {
      const pagado = await totalPagado(pedido.id_pedido, t);
      if (Number(pedido.total) <= 0) {
        throw errorHttp(400, "El pedido no tiene productos; no puede procesarse.");
      }
      if (pagado < Number(pedido.total)) {
        throw errorHttp(400, `El pedido sigue PENDIENTE de pago: pagado ${pagado.toFixed(2)} de ${Number(pedido.total).toFixed(2)}.`);
      }
    }

    // PENDIENTE -> CANCELADO: las unidades vendidas vuelven a stock DISPONIBLE.
    if (estado === 'CANCELADO') {
      if (await totalPagado(pedido.id_pedido, t) > 0) {
        throw errorHttp(400, "El pedido tiene pagos completados y no puede cancelarse sin gestionar antes el reembolso.");
      }
      // Un pago PENDIENTE (p.ej. Stripe) podría confirmarse después de cancelar: se exige anularlo antes.
      if (await totalPagado(pedido.id_pedido, t, ['PENDIENTE']) > 0) {
        throw errorHttp(400, "El pedido tiene pagos PENDIENTES; anúlelos (PUT /api/pagos/:id/anular) antes de cancelarlo.");
      }
      const detalles = await DetallePedido.findAll({
        where: { id_pedido: pedido.id_pedido },
        order: [['id_producto', 'ASC']], // mismo orden de bloqueo de inventario que las ventas
        transaction: t
      });
      for (const detalle of detalles) {
        await reintegrarStockVenta({
          id_producto: detalle.id_producto,
          id_sucursal: pedido.id_sucursal,
          cantidad: detalle.cantidad,
          id_pedido: pedido.id_pedido,
          id_empleado: req.empleadoId,
          observacion: `Pedido #${pedido.id_pedido} cancelado; unidades devueltas a stock.`
        }, t);
      }
    }

    const estadoAnterior = pedido.estado;
    pedido.estado = estado;
    await pedido.save({ transaction: t });

    await registrarAuditoria({
      id_empleado: req.empleadoId,
      accion: 'PEDIDO_ESTADO_ACTUALIZADO',
      tabla_afectada: 'Pedido',
      registro_afectado_id: pedido.id_pedido,
      detalles: `Pedido #${pedido.id_pedido} cambiado de ${estadoAnterior} a ${estado}.`
    }, t);

    await t.commit();
    res.status(200).send({
      message: `Pedido actualizado de ${estadoAnterior} a ${estado}.`,
      pedido
    });
  } catch (error) {
    await t.rollback();
    res.status(error.status || 500).send({ message: error.message || "Error al actualizar el estado del pedido." });
  }
};

// GET /api/pedidos/:id/historial — todos los movimientos de inventario ligados
// al pedido, incluyendo los originados por devoluciones/cambios asociados a él.
exports.historial = async (req, res) => {
  try {
    const id = req.params.id;
    const pedido = await Pedido.findByPk(id);
    if (!pedido) {
      return res.status(404).send({ message: `No se encontró el Pedido con id=${id}.` });
    }

    const devolucionesDelPedido = await db.devolucion.findAll({
      where: { id_pedido: id },
      attributes: ['id_devolucion']
    });
    const idsDevoluciones = devolucionesDelPedido.map(d => d.id_devolucion);

    const movimientos = await db.movimiento_inventario.findAll({
      where: {
        [db.Sequelize.Op.or]: [
          { id_pedido: id },
          { id_devolucion: { [db.Sequelize.Op.in]: idsDevoluciones } }
        ]
      },
      include: [
        { model: Producto, attributes: ['nombre', 'talla', 'color'] },
        { model: db.empleado, attributes: ['id_empleado', 'nombre', 'apellido'] }
      ],
      order: [['id_movimiento', 'ASC']]
    });

    res.status(200).send({ pedido, movimientos });
  } catch (error) {
    res.status(500).send({ message: "Error al recuperar el historial del pedido: " + error.message });
  }
};
