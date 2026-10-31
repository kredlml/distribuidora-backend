// Reglas de precio de un pedido: envío, cupones de descuento e IVA. Los precios del catálogo YA
// incluyen IVA (como se muestran a la clienta); el IVA se desglosa a partir del total.
//   total = max(0, suma de líneas − descuento) + costo de envío
const leer = (v, porDefecto) => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? porDefecto : Number(v));

const IVA_PORCENTAJE = Math.max(0, leer(process.env.IVA_PORCENTAJE, 12));
const ENVIO_COSTO = Math.max(0, leer(process.env.ENVIO_COSTO, 25));
// Compras (después del descuento) desde este monto llevan envío gratis; 0 = nunca gratis.
const ENVIO_GRATIS_DESDE = Math.max(0, leer(process.env.ENVIO_GRATIS_DESDE, 300));

const r2 = (n) => Math.round(Number(n) * 100) / 100;

// Envío a domicilio de la tienda en línea (el retiro en sucursal y las ventas de mostrador no pagan).
function costoEnvio(montoProductos, { retiro = false } = {}) {
  if (retiro) return 0;
  // En centavos: 518.31 − 218.31 da 299.99999999999994 en coma flotante.
  if (ENVIO_GRATIS_DESDE > 0 && Math.round(montoProductos * 100) >= Math.round(ENVIO_GRATIS_DESDE * 100)) return 0;
  return ENVIO_COSTO;
}

// Descuento de un cupón sobre la suma de líneas (0 si no alcanza la compra mínima).
function descuentoDeCupon(cupon, lineas) {
  if (!cupon) return 0;
  const base = Number(lineas) || 0;
  if (base <= 0 || base < Number(cupon.minimo_compra || 0)) return 0;
  const d = cupon.tipo === "PORCENTAJE" ? base * Number(cupon.valor) / 100 : Number(cupon.valor);
  return r2(Math.min(base, Math.max(0, d)));
}

// IVA incluido en un monto: base imponible + IVA.
function desgloseIva(total) {
  const t = r2(total);
  const base = r2(t / (1 + IVA_PORCENTAJE / 100));
  return { base_imponible: base, iva: r2(t - base), porcentaje: IVA_PORCENTAJE };
}

// Desglose de un pedido ya guardado (para mostrarlo en la tienda, el panel y los reportes).
function desglosePedido(pedido, lineas) {
  const subtotal = r2(lineas);
  const descuento = r2(pedido.descuento || 0);
  const envio = r2(pedido.costo_envio || 0);
  return { subtotal, descuento, costo_envio: envio, total: r2(pedido.total), ...desgloseIva(pedido.total) };
}

module.exports = { IVA_PORCENTAJE, ENVIO_COSTO, ENVIO_GRATIS_DESDE, costoEnvio, descuentoDeCupon, desgloseIva, desglosePedido, r2 };
