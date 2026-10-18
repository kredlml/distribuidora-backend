const db = require("../models");
const Op = db.Sequelize.Op;
const { registrarAuditoria } = require("./auditoria");

// Utilidades compartidas del módulo de Facturación Dinámica y Estados.
// El total del Pedido NO se calcula aquí: lo mantienen los hooks de DetallePedido.

// Error con código HTTP para que los controladores respondan 400/404 en vez de 500.
function errorHttp(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Valida que la cantidad sea un entero mayor a 0 (evita ventas con cantidades negativas o decimales).
function validarCantidad(cantidad) {
  const n = Number(cantidad);
  if (!Number.isInteger(n) || n <= 0) {
    throw errorHttp(400, "La cantidad debe ser un número entero mayor a 0.");
  }
  return n;
}

// Devuelve el producto si existe y está activo. El precio de venta siempre sale del
// catálogo (Producto.precio_unitario), nunca del body de la petición.
async function obtenerProductoVendible(id_producto, t) {
  const producto = await db.producto.findByPk(id_producto, { transaction: t });
  if (!producto) {
    throw errorHttp(404, `El producto ${id_producto} no existe.`);
  }
  if (!producto.activo) {
    throw errorHttp(400, `El producto ${id_producto} está inactivo y no puede venderse.`);
  }
  return producto;
}

// Descuenta stock DISPONIBLE por FIFO (id_inventario ASC) y registra un movimiento
// VENTA por cada lote afectado, igual que el motor de ventas original.
async function descontarStockVenta({ id_producto, id_sucursal, cantidad, id_pedido, id_empleado }, t) {
  const lotesDisponibles = await db.inventario.findAll({
    where: { id_producto, id_sucursal, estado: 'DISPONIBLE', cantidad: { [Op.gt]: 0 } },
    order: [['id_inventario', 'ASC']],
    transaction: t,
    lock: t.LOCK.UPDATE
  });

  const stockTotal = lotesDisponibles.reduce((sum, lote) => sum + lote.cantidad, 0);
  if (stockTotal < cantidad) {
    throw errorHttp(400, `Stock insuficiente del producto ${id_producto}. Solo hay ${stockTotal} unidades disponibles.`);
  }

  let restante = cantidad;
  for (const lote of lotesDisponibles) {
    if (restante === 0) break;

    const descontadoDeEsteLote = Math.min(lote.cantidad, restante);
    lote.cantidad -= descontadoDeEsteLote;
    restante -= descontadoDeEsteLote;
    await lote.save({ transaction: t });

    // Trazabilidad: registra la salida por venta de este lote específico.
    await db.movimiento_inventario.create({
      id_inventario: lote.id_inventario,
      id_producto,
      id_pedido,
      id_empleado: id_empleado || null,
      tipo_movimiento: 'VENTA',
      cantidad: descontadoDeEsteLote,
      estado_anterior: 'DISPONIBLE',
      estado_nuevo: lote.cantidad === 0 ? 'AGOTADO' : 'DISPONIBLE',
      observacion: `Venta asociada al pedido #${id_pedido}.`
    }, { transaction: t });
  }
}

// Devuelve a stock DISPONIBLE las unidades de una línea que se retira de un pedido
// (producto quitado o pedido cancelado) y deja el movimiento CANCELACION en el historial.
async function reintegrarStockVenta({ id_producto, id_sucursal, cantidad, id_pedido, id_empleado, observacion }, t) {
  let fila = await db.inventario.findOne({
    where: { id_producto, id_sucursal, estado: 'DISPONIBLE' },
    order: [['id_inventario', 'ASC']],
    transaction: t,
    lock: t.LOCK.UPDATE
  });

  if (fila) {
    fila.cantidad += cantidad;
    await fila.save({ transaction: t });
  } else {
    fila = await db.inventario.create({ id_producto, id_sucursal, cantidad, estado: 'DISPONIBLE' }, { transaction: t });
  }

  await db.movimiento_inventario.create({
    id_inventario: fila.id_inventario,
    id_producto,
    id_pedido,
    id_empleado: id_empleado || null,
    tipo_movimiento: 'CANCELACION',
    cantidad,
    estado_anterior: 'VENDIDO',
    estado_nuevo: 'DISPONIBLE',
    observacion
  }, { transaction: t });
}

// Valida un monto de dinero: mayor a 0 y con máximo 2 decimales (lo mismo que guarda
// DECIMAL(10,2) y que se envía a Stripe en centavos), para que no difieran entre sí.
function normalizarMonto(monto) {
  const n = Number(monto);
  if (!Number.isFinite(n) || n <= 0 || Math.abs(Math.round(n * 100) - n * 100) > 1e-6) {
    throw errorHttp(400, "El monto debe ser mayor a 0 y tener como máximo 2 decimales.");
  }
  return Math.round(n * 100) / 100;
}

// Suma de los pagos de un pedido en los estados indicados (por defecto, solo COMPLETADOS).
async function totalPagado(id_pedido, t, estados = ['COMPLETADO']) {
  const pagado = await db.pago.sum('monto', {
    where: { id_pedido, estado_pago: { [Op.in]: estados } },
    transaction: t
  });
  return Math.round(Number(pagado || 0) * 100) / 100;
}

// Lo pagado más lo que está en camino (pagos PENDIENTES, p.ej. un PaymentIntent de Stripe
// sin confirmar). Sirve para no aceptar cobros que, al confirmarse, superen el total.
function totalComprometido(id_pedido, t) {
  return totalPagado(id_pedido, t, ['COMPLETADO', 'PENDIENTE']);
}

// Si los pagos COMPLETADOS ya cubren el total, el pedido deja de estar PENDIENTE de pago
// y pasa automáticamente a PROCESADO. Lo usan el registro/confirmación de pagos y el webhook.
async function procesarPedidoSiEstaPagado(id_pedido, id_empleado, t) {
  const pedido = await db.pedido.findByPk(id_pedido, { transaction: t, lock: t.LOCK.UPDATE });
  if (!pedido || pedido.estado !== 'PENDIENTE' || Number(pedido.total) <= 0) {
    return pedido;
  }

  const pagado = await totalPagado(id_pedido, t);
  if (pagado < Number(pedido.total)) {
    return pedido;
  }

  pedido.estado = 'PROCESADO';
  await pedido.save({ transaction: t });

  await registrarAuditoria({
    id_empleado,
    accion: 'PEDIDO_ESTADO_ACTUALIZADO',
    tabla_afectada: 'Pedido',
    registro_afectado_id: pedido.id_pedido,
    detalles: `Pedido #${pedido.id_pedido} cambiado de PENDIENTE a PROCESADO al confirmarse el pago (pagado ${pagado.toFixed(2)} de ${Number(pedido.total).toFixed(2)}).`
  }, t);

  return pedido;
}

module.exports = {
  errorHttp,
  validarCantidad,
  normalizarMonto,
  obtenerProductoVendible,
  descontarStockVenta,
  reintegrarStockVenta,
  totalPagado,
  totalComprometido,
  procesarPedidoSiEstaPagado
};
