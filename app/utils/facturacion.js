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

// Crea un pedido PENDIENTE con sus líneas. Lo usan la venta de mostrador (POST /api/pedidos)
// y la tienda en línea (POST /api/tienda/pedidos). `lineasRecibidas` = [{ id_producto, cantidad }].
// Las líneas del mismo producto se unen y se procesan en orden de id_producto para que todas
// las ventas bloqueen el inventario en el mismo orden (sin deadlocks). El precio sale del
// catálogo y el total lo calculan los hooks de DetallePedido.
async function crearPedido({ id_cliente, id_sucursal, lineasRecibidas, id_empleado, direccion_entrega, origen }, t) {
  if (!id_cliente || !id_sucursal || !Array.isArray(lineasRecibidas) || lineasRecibidas.length === 0
    || lineasRecibidas.some(l => !l || !l.id_producto || !l.cantidad)) {
    throw errorHttp(400, "Faltan datos obligatorios para procesar la venta.");
  }

  const porProducto = new Map();
  for (const l of lineasRecibidas) {
    const id = Number(l.id_producto);
    porProducto.set(id, (porProducto.get(id) || 0) + validarCantidad(l.cantidad));
  }
  const lineas = [...porProducto.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id_producto, cantidad]) => ({ id_producto, cantidad }));

  const cliente = await db.cliente.findByPk(id_cliente, { transaction: t });
  if (!cliente || !cliente.activo) {
    throw errorHttp(400, `El cliente ${id_cliente} no existe o está inactivo.`);
  }
  const sucursal = await db.sucursal.findByPk(id_sucursal, { transaction: t });
  if (!sucursal || !sucursal.activo) {
    throw errorHttp(400, `La sucursal ${id_sucursal} no existe o está inactiva.`);
  }

  const pedido = await db.pedido.create({
    estado: 'PENDIENTE',
    total: 0,
    id_cliente,
    id_sucursal,
    id_empleado: id_empleado || null,
    direccion_entrega: direccion_entrega || null
  }, { transaction: t });

  for (const linea of lineas) {
    const producto = await obtenerProductoVendible(linea.id_producto, t);

    await descontarStockVenta({
      id_producto: producto.id_producto,
      id_sucursal,
      cantidad: linea.cantidad,
      id_pedido: pedido.id_pedido,
      id_empleado
    }, t);

    // subtotal y Pedido.total los calculan los hooks del modelo DetallePedido.
    await db.detalle_pedido.create({
      cantidad: linea.cantidad,
      precio_unitario: producto.precio_unitario,
      id_pedido: pedido.id_pedido,
      id_producto: producto.id_producto
    }, { transaction: t });
  }

  // El hook actualizó la fila en BD; se recarga para responder con el total real.
  await pedido.reload({ transaction: t });

  await registrarAuditoria({
    id_empleado,
    accion: 'PEDIDO_CREADO',
    tabla_afectada: 'Pedido',
    registro_afectado_id: pedido.id_pedido,
    detalles: `Pedido #${pedido.id_pedido} creado${origen ? ' ' + origen : ''} con ${lineas.length} línea(s) por un total de ${Number(pedido.total).toFixed(2)}.`
  }, t);

  return pedido;
}

// Cancela un pedido PENDIENTE (el pedido debe venir bloqueado por la transacción): exige que
// no tenga pagos completados ni pendientes y devuelve a stock DISPONIBLE todas sus líneas.
async function cancelarPedido(pedido, { id_empleado, motivo }, t) {
  if (pedido.estado !== 'PENDIENTE') {
    throw errorHttp(400, `Solo se puede cancelar un pedido PENDIENTE de pago (estado actual: ${pedido.estado}).`);
  }
  if (await totalPagado(pedido.id_pedido, t) > 0) {
    throw errorHttp(400, "El pedido tiene pagos completados y no puede cancelarse sin gestionar antes el reembolso.");
  }
  // Un pago PENDIENTE (p.ej. Stripe) podría confirmarse después de cancelar: se exige anularlo antes.
  if (await totalPagado(pedido.id_pedido, t, ['PENDIENTE']) > 0) {
    throw errorHttp(400, "El pedido tiene pagos PENDIENTES; anúlelos (PUT /api/pagos/:id/anular) antes de cancelarlo.");
  }

  const detalles = await db.detalle_pedido.findAll({
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
      id_empleado,
      observacion: `Pedido #${pedido.id_pedido} cancelado${motivo ? ' ' + motivo : ''}; unidades devueltas a stock.`
    }, t);
  }

  pedido.estado = 'CANCELADO';
  await pedido.save({ transaction: t });
}

// Stripe confirmó el cobro de un pago (webhook o sincronización desde la tienda). El pago debe
// venir bloqueado y en PENDIENTE/FALLIDO. El dinero ya entró: si el pedido sigue PENDIENTE y el
// monto cabe en el saldo, cuenta y el pedido puede pasar a PROCESADO; si no (pedido cancelado,
// ya pagado o cobro de más), se registra igual pero queda marcado para reembolso.
async function registrarCobroExitoso(pago, t) {
  const pedido = await db.pedido.findByPk(pago.id_pedido, { transaction: t, lock: t.LOCK.UPDATE });
  const saldo = pedido ? Math.round((Number(pedido.total) - await totalPagado(pedido.id_pedido, t)) * 100) / 100 : 0;

  pago.estado_pago = 'COMPLETADO';
  await pago.save({ transaction: t });

  if (!pedido || pedido.estado !== 'PENDIENTE' || Number(pago.monto) > saldo) {
    await registrarAuditoria({
      id_empleado: null,
      accion: 'PAGO_REQUIERE_REEMBOLSO',
      tabla_afectada: 'Pago',
      registro_afectado_id: pago.id_pago,
      detalles: `Stripe cobró ${Number(pago.monto).toFixed(2)} (pago #${pago.id_pago}) pero el pedido #${pago.id_pedido} ${pedido ? `está ${pedido.estado} con saldo ${saldo.toFixed(2)}` : 'no existe'}; debe reembolsarse.`
    }, t);
    console.warn(`Stripe: el pago #${pago.id_pago} se cobró pero requiere reembolso.`);
    return pedido;
  }

  return procesarPedidoSiEstaPagado(pago.id_pedido, null, t);
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
  procesarPedidoSiEstaPagado,
  crearPedido,
  cancelarPedido,
  registrarCobroExitoso
};
