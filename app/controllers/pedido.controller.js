const db = require("../models");
const Pedido = db.pedido;
const DetallePedido = db.detalle_pedido;
const Cliente = db.cliente;
const Sucursal = db.sucursal;
const Producto = db.producto;
const Pago = db.pago;
const { registrarAuditoria } = require("../utils/auditoria");
const { errorHttp, totalPagado, crearPedido, cancelarPedido } = require("../utils/facturacion");

const ESTADOS_PEDIDO_VALIDOS = ['PENDIENTE', 'PROCESADO', 'ENVIADO', 'ENTREGADO', 'CANCELADO'];

// POST /api/pedidos — registra una venta de mostrador.
// Body: { id_cliente, id_sucursal, detalles: [{ id_producto, cantidad }], direccion_entrega? }
// (también acepta una sola línea con id_producto/cantidad en la raíz del body).
// Todo pedido nace PENDIENTE de pago; el precio sale del catálogo y el total lo
// calculan los hooks de DetallePedido, por eso se ignoran estado/total/precio del body.
exports.create = async (req, res) => {

  const t = await db.sequelize.transaction();

  try {
    const body = req.body || {};
    const lineasRecibidas = Array.isArray(body.detalles) && body.detalles.length > 0
      ? body.detalles
      : [{ id_producto: body.id_producto, cantidad: body.cantidad }];

    const pedidoCreado = await crearPedido({
      id_cliente: body.id_cliente,
      id_sucursal: body.id_sucursal,
      lineasRecibidas,
      id_empleado: req.empleadoId,
      direccion_entrega: typeof body.direccion_entrega === 'string' ? body.direccion_entrega.trim().slice(0, 200) : null
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


// Origen de un pedido: los de la tienda en línea no tienen empleado; los de mostrador sí (el cajero).
const origenDe = (pedido) => (pedido.id_empleado ? 'MOSTRADOR' : 'TIENDA');
const ORIGENES = ['TIENDA', 'MOSTRADOR'];
const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));
// Los días del filtro desde/hasta son días de la tienda (Guatemala, UTC-6, sin horario de verano),
// no del servidor (que en la nube suele correr en UTC).
const ZONA_TIENDA = process.env.ZONA_HORARIA_TIENDA || '-06:00';

// GET /api/pedidos?estado=&id_cliente=&id_sucursal=&origen=TIENDA|MOSTRADOR&desde=&hasta=
// desde/hasta (YYYY-MM-DD) filtran por fecha_pedido, ambos extremos incluidos.
// Ej.: pedidos entregados de un cliente (candidatos a devolución):
//      /api/pedidos?id_cliente=3&estado=ENTREGADO
exports.findAll = async (req, res) => {
  try {
    const Op = db.Sequelize.Op;
    const { estado, id_cliente, id_sucursal, origen, desde, hasta } = req.query;
    const where = {};
    if (estado) {
      if (!ESTADOS_PEDIDO_VALIDOS.includes(estado)) {
        return res.status(400).send({ message: `Estado inválido. Valores permitidos: ${ESTADOS_PEDIDO_VALIDOS.join(', ')}.` });
      }
      where.estado = estado;
    }
    for (const [campo, valor] of [['id_cliente', id_cliente], ['id_sucursal', id_sucursal]]) {
      if (valor === undefined || valor === '') continue;
      if (!Number.isInteger(Number(valor)) || Number(valor) <= 0) return res.status(400).send({ message: `${campo} debe ser un número válido.` });
      where[campo] = Number(valor);
    }
    if (origen) {
      if (!ORIGENES.includes(origen)) return res.status(400).send({ message: `Origen inválido. Valores permitidos: ${ORIGENES.join(', ')}.` });
      where.id_empleado = origen === 'TIENDA' ? null : { [Op.ne]: null };
    }
    if ((desde && !esFecha(desde)) || (hasta && !esFecha(hasta))) {
      return res.status(400).send({ message: "Las fechas desde/hasta deben tener el formato AAAA-MM-DD." });
    }
    if (desde || hasta) {
      where.fecha_pedido = {};
      if (desde) where.fecha_pedido[Op.gte] = new Date(`${desde}T00:00:00${ZONA_TIENDA}`);
      if (hasta) where.fecha_pedido[Op.lte] = new Date(`${hasta}T23:59:59.999${ZONA_TIENDA}`);
    }

    const data = await Pedido.findAll({
      where,
      include: [
        { model: Cliente, attributes: ['id_cliente', 'nombre', 'apellido'] },
        { model: Sucursal, attributes: ['id_sucursal', 'nombre'] },
        { model: db.empleado, attributes: ['id_empleado', 'nombre', 'apellido'] }
      ],
      order: [['id_pedido', 'DESC']]
    });
    res.send(data.map((p) => ({ ...p.get({ plain: true }), origen: origenDe(p) })));
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al recuperar los pedidos." });
  }
};

// GET /api/pedidos/:id — detalle completo para el panel: cliente, sucursal, vendedor, líneas,
// pagos, devoluciones y los saldos calculados (pagado, por confirmar y saldo pendiente).
exports.findOne = async (req, res) => {
  try {
    const id = req.params.id;
    if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
      return res.status(400).send({ message: "El número de pedido no es válido." });
    }

    const pedido = await Pedido.findByPk(id, {
      include: [
        {
          model: Cliente,
          attributes: ['id_cliente', 'nombre', 'apellido', 'email', 'telefono', 'direccion']
        },
        {
          model: Sucursal,
          attributes: ['id_sucursal', 'nombre', 'ciudad']
        },
        { model: db.empleado, attributes: ['id_empleado', 'nombre', 'apellido'] },
        {
          model: db.detalle_pedido, // Usamos la variable exacta de tu index.js
          include: [{
            model: Producto,
            attributes: ['id_producto', 'nombre', 'talla', 'color', 'precio_unitario', 'id_producto_padre']
          }]
        },
        {
          model: Pago,
          attributes: ['id_pago', 'monto', 'metodo_pago', 'estado_pago', 'fecha_pago', 'id_transaccion_externa']
        },
        { model: db.devolucion, attributes: ['id_devolucion', 'tipo', 'estado'] }
      ],
      order: [[db.detalle_pedido, 'id_detalle_pedido', 'ASC'], [Pago, 'id_pago', 'ASC']]
    });

    if (pedido) {
      const suma = (estado) => Math.round(pedido.Pagos.filter((x) => x.estado_pago === estado).reduce((s, x) => s + Number(x.monto), 0) * 100) / 100;
      const pagado = suma('COMPLETADO'), por_confirmar = suma('PENDIENTE');
      const saldo = Math.max(0, Math.round((Number(pedido.total) - pagado) * 100) / 100);
      res.status(200).send({
        ...pedido.get({ plain: true }),
        origen: origenDe(pedido),
        pagado,
        por_confirmar,
        saldo,
        // Lo que todavía se puede cobrar sin pasarse del total (descuenta los pagos por confirmar).
        por_cobrar: Math.max(0, Math.round((saldo - por_confirmar) * 100) / 100)
      });
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

    const estadoAnterior = pedido.estado;
    if (estado === 'CANCELADO') {
      // PENDIENTE -> CANCELADO: sin pagos completados ni pendientes; el stock vuelve a DISPONIBLE.
      await cancelarPedido(pedido, { id_empleado: req.empleadoId }, t);
    } else {
      pedido.estado = estado;
      await pedido.save({ transaction: t });
    }

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
