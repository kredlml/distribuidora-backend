// Comprobantes de entrada (CE) y de salida (CS) de mercadería. Se emiten siempre dentro de la
// transacción que mueve el stock: si la operación se revierte, el comprobante y su número también.
const db = require("../models");

const PREFIJO = { ENTRADA: "CE", SALIDA: "CS" };
const folio = (c) => `${PREFIJO[c.tipo]}-${String(c.numero).padStart(6, "0")}`;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const descripcionDe = (p) => [p.nombre, p.talla, p.color].filter(Boolean).join(" ").slice(0, 200);

// Siguiente número del tipo. La fila del contador queda bloqueada hasta el commit: dos emisiones
// simultáneas se ordenan y ningún número se pierde ni se repite.
async function siguienteNumero(tipo, t) {
  const [{ ultimo }] = await db.sequelize.query(
    `INSERT INTO "ContadorComprobante" (tipo, ultimo) VALUES (:tipo, 1)
     ON CONFLICT (tipo) DO UPDATE SET ultimo = "ContadorComprobante".ultimo + 1
     RETURNING ultimo`,
    { replacements: { tipo }, type: db.Sequelize.QueryTypes.SELECT, transaction: t }
  );
  return ultimo;
}

/**
 * Emite un comprobante con sus líneas y lo devuelve (con `folio`).
 * lineas: [{ id_producto, cantidad, estado_inventario?, lote?, valor_unitario? }]
 * descuento: lo que se rebajó del valor de las líneas (cupón de una venta). fecha: solo para
 * documentar operaciones anteriores (la migración 0006); por defecto, ahora.
 * Debe ser el último bloqueo de la transacción (después de bloquear inventario o pedido): la fila
 * del contador queda tomada hasta el commit y así no hay esperas cruzadas.
 * Lanza si no hay líneas: un comprobante vacío no documenta nada.
 */
async function emitirComprobante({ tipo, concepto, id_sucursal, id_empleado, id_proveedor, documento_proveedor, id_pedido, id_devolucion, motivo, lineas, descuento, fecha }, t) {
  if (!t) throw new Error("Los comprobantes se emiten dentro de la transacción que mueve el stock.");
  const validas = (lineas || []).filter((l) => l && Number(l.cantidad) > 0);
  if (!validas.length) throw new Error("Un comprobante necesita al menos una línea con cantidad.");

  const ids = [...new Set(validas.map((l) => Number(l.id_producto)))];
  const productos = await db.producto.findAll({ where: { id_producto: ids }, attributes: ["id_producto", "nombre", "talla", "color"], transaction: t });
  const porId = new Map(productos.map((p) => [p.id_producto, p]));

  const filas = validas.map((l) => {
    const p = porId.get(Number(l.id_producto));
    const valor = l.valor_unitario == null || l.valor_unitario === "" ? null : r2(l.valor_unitario);
    return {
      id_producto: Number(l.id_producto),
      descripcion: p ? descripcionDe(p) || `Prenda #${l.id_producto}` : `Prenda #${l.id_producto}`,
      cantidad: Number(l.cantidad),
      estado_inventario: l.estado_inventario || "DISPONIBLE",
      lote: l.lote ? String(l.lote).slice(0, 255) : null,
      valor_unitario: valor,
      subtotal: valor == null ? null : r2(valor * Number(l.cantidad))
    };
  });
  const conValor = filas.filter((f) => f.subtotal != null);
  const rebaja = r2(Math.max(0, Number(descuento) || 0));
  const bruto = conValor.length ? r2(conValor.reduce((s, f) => s + f.subtotal, 0)) : null;

  const comprobante = await db.comprobante.create({
    tipo,
    numero: await siguienteNumero(tipo, t),
    concepto,
    id_sucursal,
    id_empleado: id_empleado || null,
    id_proveedor: id_proveedor || null,
    documento_proveedor: documento_proveedor || null,
    id_pedido: id_pedido || null,
    id_devolucion: id_devolucion || null,
    motivo: motivo ? String(motivo).slice(0, 255) : null,
    total_unidades: filas.reduce((s, f) => s + f.cantidad, 0),
    descuento: bruto == null ? 0 : Math.min(rebaja, bruto),
    valor_total: bruto == null ? null : r2(Math.max(0, bruto - rebaja)),
    ...(fecha ? { fecha } : {})
  }, { transaction: t });
  await db.detalle_comprobante.bulkCreate(filas.map((f) => ({ ...f, id_comprobante: comprobante.id_comprobante })), { transaction: t });
  comprobante.setDataValue("folio", folio(comprobante));
  return comprobante;
}

// Comprobante de salida de una venta: se emite cuando la venta se concreta (el pedido pasa a
// PROCESADO), con las líneas finales. Antes el stock solo está apartado: el pedido aún puede
// cambiar de líneas, cancelarse o vencer, y eso no deja documentos. Idempotente: si el pedido ya
// tiene su comprobante lo devuelve (y el índice único comprobante_venta_unica lo garantiza).
// El valor del comprobante es el de la mercadería: las líneas a precio de venta menos el descuento
// del cupón (el envío se cobra aparte y no es mercadería). `fecha` y `motivo`: ver la migración 0006.
async function emitirSalidaDeVenta(pedido, id_empleado, t, { fecha, motivo } = {}) {
  const previo = await db.comprobante.findOne({ where: { id_pedido: pedido.id_pedido, concepto: "VENTA" }, transaction: t });
  if (previo) { previo.setDataValue("folio", folio(previo)); return previo; }
  const lineas = await db.detalle_pedido.findAll({ where: { id_pedido: pedido.id_pedido }, order: [["id_producto", "ASC"]], transaction: t });
  if (!lineas.length) return null;
  const descuento = Number(pedido.descuento) || 0;
  return emitirComprobante({
    tipo: "SALIDA", concepto: "VENTA", id_sucursal: pedido.id_sucursal, id_empleado, id_pedido: pedido.id_pedido, descuento, fecha,
    motivo: motivo || `Venta del pedido #${pedido.id_pedido}${descuento > 0 ? ` con descuento de cupón de Q${descuento.toFixed(2)}` : ""}.`,
    lineas: lineas.map((l) => ({ id_producto: l.id_producto, cantidad: l.cantidad, valor_unitario: l.precio_unitario }))
  }, t);
}

module.exports = { emitirComprobante, emitirSalidaDeVenta, folio, PREFIJO };
