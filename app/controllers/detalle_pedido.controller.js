const db = require("../models");
const DetallePedido = db.detalle_pedido;
const Pedido = db.pedido;
const sequelize = db.sequelize;
const { registrarAuditoria } = require("../utils/auditoria");
const { whereSucursal } = require("../utils/alcance");
const {
  errorHttp,
  validarCantidad,
  obtenerProductoVendible,
  descontarStockVenta,
  reintegrarStockVenta,
  totalComprometido,
  procesarPedidoSiEstaPagado
} = require("../utils/facturacion");

// Busca el pedido bloqueando su fila (los hooks de dos detalles simultáneos no pisan
// el total entre sí) y exige que siga PENDIENTE de pago: una vez pagado, enviado o
// entregado su contenido ya no puede cambiar.
async function obtenerPedidoEditable(id_pedido, t) {
  const pedido = await Pedido.findByPk(id_pedido, { transaction: t, lock: t.LOCK.UPDATE });
  if (!pedido) {
    throw errorHttp(404, `No se encontró el Pedido con id=${id_pedido}.`);
  }
  if (pedido.estado !== 'PENDIENTE') {
    throw errorHttp(400, `Solo se pueden modificar los productos de un pedido PENDIENTE de pago (estado actual: ${pedido.estado}).`);
  }
  return pedido;
}

// POST /api/detalles — agrega un producto a un pedido PENDIENTE.
// Body: { id_pedido, id_producto, cantidad }. El precio sale del catálogo, el stock se
// descuenta de la sucursal del pedido y el hook afterCreate recalcula Pedido.total.
exports.create = async (req, res) => {

  const t = await sequelize.transaction();

  try {
    const { id_pedido, id_producto, id_sucursal, cantidad: cantidadRecibida } = req.body || {};

    if (!id_pedido || !id_producto || !cantidadRecibida) {
      throw errorHttp(400, "id_pedido, id_producto y cantidad son obligatorios.");
    }
    const cantidad = validarCantidad(cantidadRecibida);

    const pedido = await obtenerPedidoEditable(id_pedido, t);
    if (id_sucursal && Number(id_sucursal) !== Number(pedido.id_sucursal)) {
      throw errorHttp(400, `El pedido pertenece a la sucursal ${pedido.id_sucursal}; el stock no puede tomarse de otra sucursal.`);
    }

    const producto = await obtenerProductoVendible(id_producto, t);

    await descontarStockVenta({
      id_producto: producto.id_producto,
      id_sucursal: pedido.id_sucursal,
      cantidad,
      id_pedido: pedido.id_pedido,
      id_empleado: req.empleadoId
    }, t);

    const detalle = await DetallePedido.create({
      id_pedido: pedido.id_pedido,
      id_producto: producto.id_producto,
      cantidad,
      precio_unitario: producto.precio_unitario
    }, { transaction: t });

    await pedido.reload({ transaction: t });

    await registrarAuditoria({
      id_empleado: req.empleadoId,
      accion: 'DETALLE_PEDIDO_AGREGADO',
      tabla_afectada: 'Pedido',
      registro_afectado_id: pedido.id_pedido,
      detalles: `Se agregaron ${cantidad} u. del producto ${producto.id_producto} al pedido #${pedido.id_pedido}. Nuevo total: ${Number(pedido.total).toFixed(2)}.`
    }, t);

    await t.commit();
    res.status(201).send({ ...detalle.toJSON(), total_pedido: pedido.total });

  } catch (error) {
    // Si cualquier paso falla, deshacemos todo para evitar inconsistencias
    await t.rollback();
    res.status(error.status || 500).send({
      message: error.message || "Ocurrió un error al agregar el detalle al pedido."
    });
  }
};

// DELETE /api/detalles/:id — quita un producto de un pedido PENDIENTE. Las unidades
// vuelven a stock DISPONIBLE y el hook afterDestroy recalcula Pedido.total.
exports.delete = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    // Bloqueo de la línea: un segundo DELETE simultáneo espera y luego ya no la encuentra
    // (404), en vez de devolver su stock dos veces.
    const detalle = await DetallePedido.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!detalle) {
      throw errorHttp(404, `No se encontró el detalle con id=${req.params.id}.`);
    }

    const pedido = await obtenerPedidoEditable(detalle.id_pedido, t);

    await reintegrarStockVenta({
      id_producto: detalle.id_producto,
      id_sucursal: pedido.id_sucursal,
      cantidad: detalle.cantidad,
      id_pedido: pedido.id_pedido,
      id_empleado: req.empleadoId,
      observacion: `Producto retirado del pedido #${pedido.id_pedido} antes del pago.`
    }, t);

    await detalle.destroy({ transaction: t });
    await pedido.reload({ transaction: t });

    // Lo ya pagado (o en camino) no puede quedar por encima del nuevo total.
    const comprometido = await totalComprometido(pedido.id_pedido, t);
    if (comprometido > Number(pedido.total)) {
      throw errorHttp(400, `No se puede quitar el producto: el pedido ya tiene ${comprometido.toFixed(2)} pagado o en proceso de pago y el nuevo total sería ${Number(pedido.total).toFixed(2)}. Gestione antes el reembolso o anule el pago pendiente.`);
    }
    // Si con el nuevo total lo pagado ya lo cubre, el pedido deja de estar PENDIENTE de pago.
    await procesarPedidoSiEstaPagado(pedido.id_pedido, req.empleadoId, t);
    await pedido.reload({ transaction: t });

    await registrarAuditoria({
      id_empleado: req.empleadoId,
      accion: 'DETALLE_PEDIDO_ELIMINADO',
      tabla_afectada: 'Pedido',
      registro_afectado_id: pedido.id_pedido,
      detalles: `Se quitaron ${detalle.cantidad} u. del producto ${detalle.id_producto} del pedido #${pedido.id_pedido}. Nuevo total: ${Number(pedido.total).toFixed(2)}.`
    }, t);

    await t.commit();
    res.status(200).send({
      message: "Producto retirado del pedido.",
      id_detalle_pedido: detalle.id_detalle_pedido,
      total_pedido: pedido.total,
      estado_pedido: pedido.estado
    });
  } catch (error) {
    await t.rollback();
    res.status(error.status || 500).send({
      message: error.message || "Ocurrió un error al quitar el detalle del pedido."
    });
  }
};


// GET /api/detalles?id_pedido= — filtro opcional por pedido.
exports.findAll = async (req, res) => {
  try {
    const where = {};
    if (req.query.id_pedido) where.id_pedido = req.query.id_pedido;
    // Solo líneas de pedidos de la propia sucursal (el DISTRITAL, todas).
    const alcance = whereSucursal(req);
    const include = Object.keys(alcance).length ? [{ model: db.pedido, attributes: [], where: alcance }] : [];
    const data = await DetallePedido.findAll({ where, include, order: [['id_detalle_pedido', 'ASC']] });
    res.send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al recuperar los detalles." });
  }
};


exports.findOne = async (req, res) => {
  try {
    const data = await DetallePedido.findByPk(req.params.id);
    if (data) {
      res.send(data);
    } else {
      res.status(404).send({ message: `No se encontró el detalle con id=${req.params.id}.` });
    }
  } catch (error) {
    res.status(500).send({ message: "Error al recuperar el detalle con id=" + req.params.id });
  }
};
