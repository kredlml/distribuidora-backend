const db = require("../models");
const Producto = db.producto;
const Pedido = db.pedido;
const Pago = db.pago;
const Op = db.Sequelize.Op;
const { stripe, STRIPE_SIMULADO } = require("../config/stripe.config");
const { registrarAuditoria } = require("../utils/auditoria");
const {
  errorHttp,
  totalPagado,
  totalComprometido,
  procesarPedidoSiEstaPagado,
  crearPedido,
  cancelarPedido,
  registrarCobroExitoso
} = require("../utils/facturacion");
const devoluciones = require("./devolucion.controller.js");
const { esPagoStripeReal, centavos, anularPagoPendiente, cancelarIntentoStripe } = require("../utils/pagosStripe");
const { venceEl, estaVencido, HORAS_PEDIDO_PENDIENTE } = require("../utils/vencimientos");
const { desglosePedido } = require("../utils/precios");
const { cotizar } = require("../utils/cotizacion");

// Tienda en línea para clientes. Reutiliza las reglas del panel: el total lo calculan los
// hooks de DetallePedido, los estados siguen la máquina de estados del pedido y las
// devoluciones entran al flujo de Logística inversa (devolucion.controller) sin cambios.

const MAX_PEDIDOS_PENDIENTES = 3; // evita que una cuenta acapare stock con pedidos sin pagar
const MAX_UNIDADES_POR_LINEA = 20;

// Errores previstos (400, 404, 409…) con su mensaje; los inesperados (500) con un mensaje genérico:
// el detalle interno queda en el registro de errores, nunca se muestra a la clienta.
const responderError = (res, error, porDefecto) => {
  if (error.status && error.status < 500) return res.status(error.status).send({ message: error.message || porDefecto });
  res.locals.pilaError = error && error.stack;
  res.locals.mensajeError = error && error.message; // para el registro de errores
  res.status(error.status || 500).send({ message: error.status ? error.message : porDefecto });
};

// ---------------------------------------------------------------------------
// Catálogo (público)
// ---------------------------------------------------------------------------

// Stock DISPONIBLE de los productos indicados, solo en sucursales activas.
// Devuelve Map id_producto -> { total, porSucursal: { id_sucursal: n } }.
async function stockDe(ids) {
  const mapa = new Map();
  if (ids.length === 0) return mapa;
  const filas = await db.inventario.findAll({
    attributes: ['id_producto', 'id_sucursal', [db.sequelize.fn('SUM', db.sequelize.col('cantidad')), 'stock']],
    where: { id_producto: { [Op.in]: ids }, estado: 'DISPONIBLE' },
    include: [{ model: db.sucursal, attributes: [], where: { activo: true } }],
    group: ['Inventario.id_producto', 'Inventario.id_sucursal'],
    raw: true
  });
  for (const f of filas) {
    const s = Math.max(0, Number(f.stock) || 0);
    const e = mapa.get(f.id_producto) || { total: 0, porSucursal: {} };
    e.total += s;
    e.porSucursal[f.id_sucursal] = s;
    mapa.set(f.id_producto, e);
  }
  return mapa;
}

const raizDe = (p) => Number(p.id_producto_padre || p.id_producto);

// Agrupa productos activos en "prendas" (producto base + variantes de talla/color).
function agrupar(productos, stock, id_sucursal) {
  const grupos = new Map();
  for (const p of productos) {
    const raiz = raizDe(p);
    if (!grupos.has(raiz)) grupos.set(raiz, []);
    grupos.get(raiz).push(p);
  }
  const prendas = [];
  for (const [raiz, miembros] of grupos) {
    miembros.sort((a, b) => a.id_producto - b.id_producto);
    const base = miembros.find(m => m.id_producto === raiz) || miembros[0];
    const variantes = miembros.map(m => {
      const s = stock.get(m.id_producto) || { total: 0, porSucursal: {} };
      return {
        id_producto: m.id_producto,
        talla: m.talla,
        color: m.color,
        precio_unitario: Number(m.precio_unitario),
        imagen_url: m.imagen_url,
        stock: id_sucursal ? (s.porSucursal[id_sucursal] || 0) : s.total,
        stock_por_sucursal: s.porSucursal
      };
    });
    const precios = variantes.map(v => v.precio_unitario);
    // Sequelize nombra el include de "Categoria" como "Categorium" (singularización).
    const cat = base.Categorium || base.Categoria;
    prendas.push({
      id_prenda: raiz,
      nombre: base.nombre,
      descripcion: base.descripcion,
      imagen_url: base.imagen_url || (miembros.find(m => m.imagen_url) || {}).imagen_url || null,
      categoria: cat ? { id_categoria: cat.id_categoria, nombre: cat.nombre } : null,
      id_categoria: base.id_categoria,
      precio_min: Math.min(...precios),
      precio_max: Math.max(...precios),
      stock: variantes.reduce((s, v) => s + v.stock, 0),
      variantes
    });
  }
  return prendas;
}

// GET /api/tienda/catalogo?q=&id_categoria=&id_sucursal=
exports.catalogo = async (req, res) => {
  try {
    const { q, id_categoria } = req.query;
    const id_sucursal = req.query.id_sucursal ? Number(req.query.id_sucursal) : null;

    const productos = await Producto.findAll({
      where: { activo: true },
      include: [{ model: db.categoria, attributes: ['id_categoria', 'nombre'] }]
    });
    const stock = await stockDe(productos.map(p => p.id_producto));
    let prendas = agrupar(productos, stock, id_sucursal);

    if (id_categoria) prendas = prendas.filter(p => Number(p.id_categoria) === Number(id_categoria));
    if (q && String(q).trim()) {
      const texto = String(q).trim().toLowerCase();
      prendas = prendas.filter(p => [p.nombre, p.descripcion, p.categoria && p.categoria.nombre,
        ...p.variantes.flatMap(v => [v.color, v.talla])].some(x => x && String(x).toLowerCase().includes(texto)));
    }
    // Primero lo que tiene existencias; luego por nombre.
    prendas.sort((a, b) => (b.stock > 0) - (a.stock > 0) || a.nombre.localeCompare(b.nombre, 'es'));
    res.send(prendas);
  } catch (error) {
    responderError(res, error, "Error al recuperar el catálogo.");
  }
};

// GET /api/tienda/catalogo/:id — una prenda (cualquier id de su grupo) con stock por sucursal.
exports.prenda = async (req, res) => {
  try {
    const producto = await Producto.findByPk(req.params.id);
    if (!producto) throw errorHttp(404, "La prenda no existe.");
    const raiz = raizDe(producto);

    const miembros = await Producto.findAll({
      where: { activo: true, [Op.or]: [{ id_producto: raiz }, { id_producto_padre: raiz }] },
      include: [{ model: db.categoria, attributes: ['id_categoria', 'nombre'] }]
    });
    if (miembros.length === 0) throw errorHttp(404, "La prenda no está disponible.");

    const stock = await stockDe(miembros.map(m => m.id_producto));
    const [prendaAgrupada] = agrupar(miembros, stock, null);
    const sucursales = await db.sucursal.findAll({
      where: { activo: true },
      attributes: ['id_sucursal', 'nombre', 'ciudad', 'direccion'],
      order: [['nombre', 'ASC']]
    });
    res.send({ ...prendaAgrupada, sucursales });
  } catch (error) {
    responderError(res, error, "Error al recuperar la prenda.");
  }
};

// ---------------------------------------------------------------------------
// Pedidos del cliente
// ---------------------------------------------------------------------------

// Pedido del cliente autenticado (404 si no existe o es de otro cliente: no se revela cuál).
async function pedidoPropio(req, opciones = {}) {
  const pedido = await Pedido.findByPk(req.params.id, opciones);
  if (!pedido || Number(pedido.id_cliente) !== Number(req.clienteId)) {
    throw errorHttp(404, "No se encontró el pedido.");
  }
  return pedido;
}

const ATRIBUTOS_PAGO = ['id_pago', 'metodo_pago', 'monto', 'estado_pago', 'fecha_pago'];

// Foto de la prenda base, para variantes que no tienen imagen propia.
const INCLUDE_FOTO_PADRE = { model: Producto, as: 'ProductoPadre', attributes: ['imagen_url'] };

// POST /api/tienda/pedidos — { id_sucursal, direccion_entrega?, detalles: [{ id_producto, cantidad }] }
exports.crearPedido = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const b = req.body || {};
    if (!Array.isArray(b.detalles) || b.detalles.length === 0) {
      throw errorHttp(400, "El carrito está vacío.");
    }
    if (b.detalles.length > 50) {
      throw errorHttp(400, "El pedido no puede tener más de 50 productos distintos.");
    }
    // El tope se valida por producto ya sumado: repetir la misma prenda en varias líneas no lo evade.
    const unidadesPorProducto = new Map();
    for (const d of b.detalles) {
      if (!d) continue;
      const id = Number(d.id_producto);
      unidadesPorProducto.set(id, (unidadesPorProducto.get(id) || 0) + (Number(d.cantidad) || 0));
    }
    if ([...unidadesPorProducto.values()].some(n => n > MAX_UNIDADES_POR_LINEA)) {
      throw errorHttp(400, `Puedes comprar como máximo ${MAX_UNIDADES_POR_LINEA} unidades de cada prenda por pedido.`);
    }

    const cliente = await db.cliente.findByPk(req.clienteId, { transaction: t, lock: t.LOCK.UPDATE });
    // Retiro en sucursal: sin dirección y sin costo de envío.
    const retiro = b.retiro_en_sucursal === true;
    const direccion = retiro ? "" : String(b.direccion_entrega || cliente.direccion || "").trim();
    if (!direccion && !retiro) {
      throw errorHttp(400, "Indica la dirección de entrega o elige retirar en la sucursal.");
    }
    if (direccion.length > 200) {
      throw errorHttp(400, "La dirección de entrega no puede superar los 200 caracteres.");
    }

    // La fila del cliente está bloqueada: dos checkouts simultáneos no pueden pasar el límite.
    const pendientes = await Pedido.count({ where: { id_cliente: req.clienteId, estado: 'PENDIENTE' }, transaction: t });
    if (pendientes >= MAX_PEDIDOS_PENDIENTES) {
      throw errorHttp(400, `Tienes ${pendientes} pedidos pendientes de pago. Págalos o cancélalos antes de hacer otro.`);
    }

    const pedido = await crearPedido({
      id_cliente: req.clienteId,
      id_sucursal: b.id_sucursal,
      lineasRecibidas: b.detalles,
      id_empleado: null,
      direccion_entrega: direccion || null,
      origen: retiro ? 'desde la tienda en línea (retiro en sucursal)' : 'desde la tienda en línea',
      cupon: typeof b.cupon === 'string' && b.cupon.trim() ? b.cupon : undefined,
      envio: { retiro }
    }, t);

    await t.commit();
    res.status(201).send({ message: HORAS_PEDIDO_PENDIENTE > 0 ? `Pedido creado. Págalo en las próximas ${HORAS_PEDIDO_PENDIENTE} horas o se cancelará.` : "Pedido creado. Completa el pago para procesarlo.", pedido: { ...pedido.toJSON(), pago_vence: venceEl(pedido) } });
  } catch (error) {
    await t.rollback();
    responderError(res, error, "Error al crear el pedido.");
  }
};

// GET /api/tienda/pedidos
// POST /api/tienda/cotizar — { id_sucursal, detalles, cupon?, retiro_en_sucursal? }: cuánto se
// pagaría (subtotal, descuento, envío, total, IVA) antes de confirmar el pedido.
exports.cotizar = async (req, res) => {
  try {
    const b = req.body || {};
    res.send(await cotizar({ detalles: b.detalles, id_sucursal: b.id_sucursal, cupon: b.cupon, envio: { retiro: b.retiro_en_sucursal === true } }));
  } catch (error) {
    responderError(res, error, "Error al cotizar el pedido.");
  }
};

exports.misPedidos = async (req, res) => {
  try {
    const pedidos = await Pedido.findAll({
      where: { id_cliente: req.clienteId },
      include: [
        { model: db.sucursal, attributes: ['id_sucursal', 'nombre'] },
        { model: db.detalle_pedido, attributes: ['id_detalle_pedido', 'cantidad'],
          include: [{ model: Producto, attributes: ['id_producto', 'nombre', 'imagen_url'], include: [INCLUDE_FOTO_PADRE] }] }
      ],
      order: [['id_pedido', 'DESC']]
    });
    res.send(pedidos.map((p) => ({ ...p.toJSON(), pago_vence: venceEl(p) })));
  } catch (error) {
    responderError(res, error, "Error al recuperar tus pedidos.");
  }
};

// Lo que la clienta ve de sus reembolsos (sin referencias internas de caja ni ids de Stripe).
const ATRIBUTOS_REEMBOLSO = ['id_reembolso', 'id_devolucion', 'metodo', 'monto', 'estado', 'fecha_creacion', 'fecha_completado'];

// GET /api/tienda/pedidos/:id — detalle con líneas, pagos, saldo y devoluciones asociadas.
exports.miPedido = async (req, res) => {
  try {
    const pedido = await pedidoPropio(req, {
      include: [
        { model: db.sucursal, attributes: ['id_sucursal', 'nombre', 'ciudad', 'direccion'] },
        { model: db.detalle_pedido,
          include: [{ model: Producto, attributes: ['id_producto', 'id_producto_padre', 'nombre', 'talla', 'color', 'imagen_url'], include: [INCLUDE_FOTO_PADRE] }] },
        { model: Pago, attributes: ATRIBUTOS_PAGO },
        { model: db.devolucion, attributes: ['id_devolucion', 'tipo', 'estado', 'fecha_solicitud'] },
        { model: db.reembolso, attributes: ATRIBUTOS_REEMBOLSO },
        { model: db.cupon, attributes: ['codigo', 'descripcion'] }
      ],
      order: [[db.detalle_pedido, 'id_detalle_pedido', 'ASC'], [Pago, 'id_pago', 'ASC']]
    });
    const pagado = await totalPagado(pedido.id_pedido);
    const enProceso = await totalPagado(pedido.id_pedido, undefined, ['PENDIENTE']);
    const enCaja = (pedido.Pagos || [])
      .filter(p => p.estado_pago === 'PENDIENTE' && p.metodo_pago !== 'STRIPE')
      .reduce((s, p) => s + Number(p.monto), 0);
    const saldo = Math.max(0, Math.round((Number(pedido.total) - pagado) * 100) / 100);
    // Si hoy puede pedir cambio o devolución: una sola vez y dentro del plazo desde la entrega.
    const politica = await devoluciones.politicaDevolucion(pedido);
    res.send({
      ...pedido.toJSON(),
      // Hasta cuándo puede pagarse (solo PENDIENTE); después se cancela automáticamente.
      pago_vence: venceEl(pedido),
      // Subtotal de prendas, descuento del cupón, envío, total e IVA incluido.
      desglose: desglosePedido(pedido, (pedido.DetallePedidos || []).reduce((s, l) => s + Number(l.subtotal), 0)),
      devolucion_permitida: politica.permite,
      devolucion_motivo: politica.motivo,
      devolucion_vence: politica.vence,
      pagado,
      pago_en_proceso: enProceso,
      saldo,
      // Lo que se cobrará con tarjeta: el saldo menos lo que ya está por confirmarse en caja.
      a_pagar_con_tarjeta: Math.max(0, Math.round((saldo - enCaja) * 100) / 100)
    });
  } catch (error) {
    responderError(res, error, "Error al recuperar el pedido.");
  }
};


// POST /api/tienda/pedidos/:id/cancelar — solo mientras siga PENDIENTE de pago.
// Si el cliente había iniciado un pago con tarjeta, se cancela también en Stripe.
exports.cancelarPedido = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    await pedidoPropio(req, { transaction: t });

    // Orden de bloqueo: primero los pagos, luego el pedido (igual que el webhook).
    const pendientes = await Pago.findAll({
      where: { id_pedido: req.params.id, estado_pago: 'PENDIENTE' }, order: [['id_pago', 'ASC']],
      transaction: t,
      lock: t.LOCK.UPDATE
    });
    const pedido = await Pedido.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });

    // Todo lo que puede impedir la cancelación se valida ANTES de tocar Stripe: cancelar un
    // PaymentIntent es irreversible y no se deshace con el rollback de la base de datos.
    if (pedido.estado !== 'PENDIENTE') {
      throw errorHttp(400, `Solo se puede cancelar un pedido pendiente de pago (estado actual: ${pedido.estado}).`);
    }
    if (await totalPagado(pedido.id_pedido, t) > 0) {
      throw errorHttp(400, "Tu pedido ya tiene pagos registrados. Comunícate con la tienda para cancelarlo.");
    }
    if (pendientes.some(p => p.metodo_pago !== 'STRIPE')) {
      throw errorHttp(400, "Tu pedido tiene un pago registrado en caja pendiente de confirmar. Comunícate con la tienda para cancelarlo.");
    }

    for (const pago of pendientes) {
      if (esPagoStripeReal(pago)) {
        const resultado = await cancelarIntentoStripe(pago);
        if (resultado === 'cobrado') {
          // Stripe ya cobró: se registra el pago (el pedido pasa a PROCESADO) y no se cancela.
          await registrarCobroExitoso(pago, t);
          await t.commit();
          return res.status(409).send({ message: "Tu pago con tarjeta ya se completó, así que el pedido no puede cancelarse." });
        }
        if (resultado === 'procesando') {
          throw errorHttp(400, "Tu pago con tarjeta se está procesando y no puede cancelarse. Actualiza la página en unos segundos.");
        }
      }
      await anularPagoPendiente(pago, "pedido cancelado por el cliente", t);
    }

    await cancelarPedido(pedido, { id_empleado: null, motivo: 'por el cliente desde la tienda' }, t);

    await registrarAuditoria({
      id_empleado: null,
      accion: 'PEDIDO_ESTADO_ACTUALIZADO',
      tabla_afectada: 'Pedido',
      registro_afectado_id: pedido.id_pedido,
      detalles: `Pedido #${pedido.id_pedido} cambiado de PENDIENTE a CANCELADO por el cliente desde la tienda.`
    }, t);

    await t.commit();
    res.send({ message: "Pedido cancelado.", pedido });
  } catch (error) {
    await t.rollback();
    responderError(res, error, "Error al cancelar el pedido.");
  }
};

// POST /api/tienda/pedidos/:id/pago — inicia (o retoma) el pago con tarjeta del saldo.
// Respuesta: { modo: 'stripe', client_secret, id_pago, monto } para confirmar con Stripe.js;
// { modo: 'stripe', procesando: true, id_pago } si Stripe ya está cobrando (llamar a /pago/confirmar);
// { modo: 'simulado', estado_pedido } con la clave de pruebas (cobro inmediato).
exports.iniciarPago = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    await pedidoPropio(req, { transaction: t });
    // Orden de bloqueo Pago -> Pedido (igual que webhook, confirmarPago y cancelarPedido).
    const bloqueados = await Pago.findAll({
      where: { id_pedido: req.params.id, estado_pago: 'PENDIENTE', metodo_pago: 'STRIPE' }, order: [['id_pago', 'ASC']],
      transaction: t,
      lock: t.LOCK.UPDATE
    });
    const idsBloqueados = new Set(bloqueados.map(p => p.id_pago));
    const pedido = await Pedido.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (pedido.estado !== 'PENDIENTE') {
      throw errorHttp(400, `Este pedido ya no está pendiente de pago (estado: ${pedido.estado}).`);
    }
    // Venció el plazo para pagarlo: se cancelará en la próxima revisión (no se inicia un cobro nuevo).
    if (estaVencido(pedido) && bloqueados.length === 0) {
      throw errorHttp(400, `El plazo de ${HORAS_PEDIDO_PENDIENTE} horas para pagar este pedido venció. Haz un pedido nuevo.`);
    }
    const total = Number(pedido.total);
    if (total <= 0) throw errorHttp(400, "El pedido no tiene productos.");

    if (STRIPE_SIMULADO) {
      const saldo = Math.round((total - await totalComprometido(pedido.id_pedido, t)) * 100) / 100;
      if (saldo <= 0) throw errorHttp(400, "Este pedido ya tiene un pago en proceso.");
      const pago = await Pago.create({
        metodo_pago: 'STRIPE', monto: saldo, estado_pago: 'COMPLETADO',
        id_transaccion_externa: 'pi_simulado_' + pedido.id_pedido + '_' + Date.now(), id_pedido: pedido.id_pedido
      }, { transaction: t });
      const actualizado = await procesarPedidoSiEstaPagado(pedido.id_pedido, null, t);
      await t.commit();
      return res.status(201).send({ modo: 'simulado', id_pago: pago.id_pago, monto: saldo, estado_pedido: actualizado.estado });
    }

    // ¿Ya hay un cobro con tarjeta en curso? Se retoma en lugar de crear otro (doble clic, recarga).
    // Se vuelve a leer tras bloquear el pedido: incluye el que otra petición haya creado mientras tanto.
    const pendientesStripe = await Pago.findAll({
      where: { id_pedido: pedido.id_pedido, estado_pago: 'PENDIENTE', metodo_pago: 'STRIPE' },
      order: [['id_pago', 'DESC']],
      transaction: t
    });
    const comprometido = await totalComprometido(pedido.id_pedido, t);
    for (const pago of pendientesStripe.filter(esPagoStripeReal)) {
      let pi;
      try {
        pi = await stripe.paymentIntents.retrieve(pago.id_transaccion_externa);
      } catch (stripeError) {
        throw errorHttp(502, "No se pudo consultar el pago en Stripe: " + stripeError.message);
      }
      if (pi.status === 'processing' || pi.status === 'succeeded') {
        await t.commit();
        return res.send({ modo: 'stripe', procesando: true, id_pago: pago.id_pago });
      }
      // Solo se reutiliza si cobra exactamente lo que hoy falta pagar (el total pudo cambiar).
      const debeCobrar = total - comprometido + Number(pago.monto);
      const reutilizable = ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(pi.status)
        && pi.amount === centavos(pago.monto) && centavos(pago.monto) === centavos(debeCobrar);
      if (reutilizable) {
        await t.commit();
        return res.send({ modo: 'stripe', client_secret: pi.client_secret, id_pago: pago.id_pago, monto: Number(pago.monto) });
      }
      if (!idsBloqueados.has(pago.id_pago)) {
        // Lo creó otra petición simultánea que no tenemos bloqueado: no se toca.
        throw errorHttp(409, "Hay otro intento de pago en curso para este pedido. Actualiza la página.");
      }
      // Cancelado en Stripe o con un monto que ya no corresponde: se descarta y se crea otro.
      if (pi.status !== 'canceled') {
        const resultado = await cancelarIntentoStripe(pago);
        if (resultado === 'cobrado') {
          await registrarCobroExitoso(pago, t);
          await t.commit();
          return res.send({ modo: 'stripe', procesando: true, id_pago: pago.id_pago });
        }
        if (resultado === 'procesando') {
          await t.commit();
          return res.send({ modo: 'stripe', procesando: true, id_pago: pago.id_pago });
        }
      }
      await anularPagoPendiente(pago, "reemplazado por un nuevo intento de pago", t);
    }

    const saldo = Math.round((total - await totalComprometido(pedido.id_pedido, t)) * 100) / 100;
    if (saldo <= 0) {
      throw errorHttp(400, "Este pedido ya tiene un pago pendiente de confirmar en caja.");
    }

    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(saldo * 100),
        currency: 'gtq',
        payment_method_types: ['card'],
        metadata: { pedido_id: pedido.id_pedido, cliente_id: req.clienteId, origen: 'tienda' }
      });
    } catch (stripeError) {
      throw errorHttp(502, "Error en pasarela Stripe: " + stripeError.message);
    }

    const pago = await Pago.create({
      metodo_pago: 'STRIPE', monto: saldo, estado_pago: 'PENDIENTE',
      id_transaccion_externa: paymentIntent.id, id_pedido: pedido.id_pedido
    }, { transaction: t });

    await t.commit();
    res.status(201).send({ modo: 'stripe', client_secret: paymentIntent.client_secret, id_pago: pago.id_pago, monto: saldo });
  } catch (error) {
    await t.rollback();
    responderError(res, error, "Error al iniciar el pago.");
  }
};

// POST /api/tienda/pedidos/:id/pago/confirmar — { id_pago? }. Tras confirmar la tarjeta con
// Stripe.js, consulta el PaymentIntent y, si se cobró, registra el pago sin esperar al webhook
// (útil en local sin Stripe CLI). Si el webhook llegó antes, no hace nada dos veces.
exports.confirmarPago = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const pedido = await pedidoPropio(req, { transaction: t });
    const where = { id_pedido: pedido.id_pedido, metodo_pago: 'STRIPE' };
    if (req.body && req.body.id_pago) where.id_pago = req.body.id_pago;

    // Orden de bloqueo: pago y luego pedido (registrarCobroExitoso), igual que el webhook.
    const pago = await Pago.findOne({ where, order: [['id_pago', 'DESC']], transaction: t, lock: t.LOCK.UPDATE });
    if (!pago) throw errorHttp(404, "No se encontró el pago.");

    let mensaje = "Pago confirmado.";
    if ((pago.estado_pago === 'PENDIENTE' || pago.estado_pago === 'FALLIDO') && esPagoStripeReal(pago)) {
      let pi;
      try {
        pi = await stripe.paymentIntents.retrieve(pago.id_transaccion_externa);
      } catch (stripeError) {
        throw errorHttp(502, "No se pudo consultar el pago en Stripe: " + stripeError.message);
      }
      if (pi.status === 'succeeded') {
        await registrarCobroExitoso(pago, t);
      } else if (pi.status === 'processing') {
        mensaje = "Tu banco está procesando el pago; te avisaremos cuando se confirme.";
      } else {
        mensaje = "El pago aún no se ha completado.";
      }
    }

    const actualizado = await Pedido.findByPk(pedido.id_pedido, { transaction: t });
    await t.commit();
    res.send({ message: mensaje, estado_pago: pago.estado_pago, estado_pedido: actualizado.estado });
  } catch (error) {
    await t.rollback();
    responderError(res, error, "Error al confirmar el pago.");
  }
};

// ---------------------------------------------------------------------------
// Devoluciones y cambios (delegan en el módulo de Logística inversa)
// ---------------------------------------------------------------------------

// GET /api/tienda/pedidos/:id/devolvible
exports.devolvible = async (req, res) => {
  try {
    await pedidoPropio(req);
    req.params.id_pedido = req.params.id;
    return devoluciones.devolvible(req, res);
  } catch (error) {
    responderError(res, error, "Error al consultar el pedido.");
  }
};

// POST /api/tienda/devoluciones — { id_pedido, tipo, motivo, observacion?, detalles: [{ id_detalle_pedido, cantidad, id_producto_nuevo? }] }
// El id_cliente sale del token; las validaciones (pedido ENTREGADO, cantidades, variantes) son
// las mismas del mostrador. id_empleado queda NULL en la trazabilidad: lo originó el cliente.
// Serializa (en este proceso) las solicitudes de un mismo pedido: devoluciones.create valida las
// cantidades ya solicitadas sin bloquear filas, y dos solicitudes simultáneas pasarían ambas.
const colasDevolucion = new Map();
function enColaDePedido(clave, fn) {
  const anterior = colasDevolucion.get(clave) || Promise.resolve();
  const actual = anterior.then(fn, fn);
  colasDevolucion.set(clave, actual);
  const limpiar = () => { if (colasDevolucion.get(clave) === actual) colasDevolucion.delete(clave); };
  actual.then(limpiar, limpiar);
  return actual;
}

exports.solicitarDevolucion = async (req, res) => {
  const b = req.body || {};
  if (typeof b.observacion === 'string' && b.observacion.trim().length > 255) {
    return res.status(400).send({ message: "El comentario no puede superar los 255 caracteres." });
  }

  // En la tienda un cambio no puede ser por una variante más cara que la comprada: no hay cómo
  // cobrar la diferencia en línea (en mostrador lo decide el personal).
  if ((b.tipo === 'CAMBIO_TALLA' || b.tipo === 'CAMBIO_VARIANTE') && Array.isArray(b.detalles)) {
    try {
      for (const d of b.detalles) {
        if (!d || !d.id_producto_nuevo || !d.id_detalle_pedido) continue; // devoluciones.create lo rechaza
        const linea = await db.detalle_pedido.findOne({ where: { id_detalle_pedido: d.id_detalle_pedido, id_pedido: b.id_pedido } });
        const nuevo = await Producto.findByPk(d.id_producto_nuevo);
        if (linea && nuevo && centavos(nuevo.precio_unitario) > centavos(linea.precio_unitario)) {
          return res.status(400).send({
            message: `La variante elegida cuesta ${Number(nuevo.precio_unitario).toFixed(2)} y pagaste ${Number(linea.precio_unitario).toFixed(2)}. Para cambiar por una prenda más cara acércate a una sucursal.`
          });
        }
      }
    } catch (error) {
      return responderError(res, error, "Error al validar la solicitud.");
    }
  }

  req.body = {
    id_pedido: b.id_pedido,
    id_cliente: req.clienteId,
    tipo: b.tipo,
    motivo: b.motivo,
    observacion: typeof b.observacion === 'string' && b.observacion.trim() ? b.observacion.trim() : null,
    detalles: Array.isArray(b.detalles)
      ? b.detalles.map(d => ({ id_detalle_pedido: d && d.id_detalle_pedido, cantidad: d && Number(d.cantidad), id_producto_nuevo: d && d.id_producto_nuevo }))
      : b.detalles
  };
  return enColaDePedido(Number(b.id_pedido) || 0, () => devoluciones.create(req, res));
};

const INCLUDE_DETALLES_DEVOLUCION = {
  model: db.detalle_devolucion,
  attributes: ['id_detalle_devolucion', 'id_detalle_pedido', 'cantidad', 'resultado_revision'],
  include: [
    { model: Producto, attributes: ['id_producto', 'nombre', 'talla', 'color', 'imagen_url'], include: [INCLUDE_FOTO_PADRE] },
    { model: Producto, as: 'ProductoNuevo', attributes: ['id_producto', 'nombre', 'talla', 'color'] }
  ]
};

// GET /api/tienda/devoluciones
exports.misDevoluciones = async (req, res) => {
  try {
    const data = await db.devolucion.findAll({
      where: { id_cliente: req.clienteId },
      attributes: ['id_devolucion', 'id_pedido', 'tipo', 'motivo', 'estado', 'fecha_solicitud', 'fecha_actualizacion'],
      include: [INCLUDE_DETALLES_DEVOLUCION],
      order: [['id_devolucion', 'DESC']]
    });
    res.send(data);
  } catch (error) {
    responderError(res, error, "Error al recuperar tus devoluciones.");
  }
};

// GET /api/tienda/devoluciones/:id — con la línea de tiempo de estados (sin notas internas).
exports.miDevolucion = async (req, res) => {
  try {
    const devolucion = await db.devolucion.findByPk(req.params.id, {
      attributes: ['id_devolucion', 'id_pedido', 'tipo', 'motivo', 'estado', 'observacion', 'fecha_solicitud', 'fecha_actualizacion'],
      include: [INCLUDE_DETALLES_DEVOLUCION, { model: db.reembolso, attributes: ATRIBUTOS_REEMBOLSO }]
    });
    if (!devolucion || !(await db.devolucion.count({ where: { id_devolucion: req.params.id, id_cliente: req.clienteId } }))) {
      throw errorHttp(404, "No se encontró la devolución.");
    }
    const auditoria = await db.auditoria.findAll({
      where: { tabla_afectada: 'Devolucion', registro_afectado_id: devolucion.id_devolucion },
      attributes: ['accion', 'createdAt'],
      order: [['id_auditoria', 'ASC']]
    });
    const historial = [{ estado: 'SOLICITADA', fecha: devolucion.fecha_solicitud }]
      .concat(auditoria.map(a => ({ estado: a.accion.replace(/^DEVOLUCION_/, ''), fecha: a.createdAt })));
    res.send({ ...devolucion.toJSON(), historial });
  } catch (error) {
    responderError(res, error, "Error al recuperar la devolución.");
  }
};
