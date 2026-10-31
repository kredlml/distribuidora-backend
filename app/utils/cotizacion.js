const db = require("../models");
const { errorHttp, validarCantidad } = require("./facturacion");
const { evaluarCupon, normalizarCodigo } = require("./cupones");
const { costoEnvio, desgloseIva, r2 } = require("./precios");

// Cotiza un carrito con los precios del catálogo: subtotal, descuento del cupón, envío, total e
// IVA incluido. No reserva nada ni usa el cupón (eso pasa al crear el pedido). Un cupón que no
// aplica no es un error: se informa en cupon_error y se cotiza sin descuento.
// `envio`: { retiro } en la tienda; null en mostrador (sin envío).
async function cotizar({ detalles, id_sucursal, cupon, envio }) {
  if (!Array.isArray(detalles) || detalles.length === 0) throw errorHttp(400, "El carrito está vacío.");
  if (detalles.length > 50) throw errorHttp(400, "Demasiadas prendas distintas.");
  const cantidades = new Map();
  for (const d of detalles) {
    if (!d || !Number.isInteger(Number(d.id_producto)) || Number(d.id_producto) <= 0) throw errorHttp(400, "Prenda inválida.");
    cantidades.set(Number(d.id_producto), (cantidades.get(Number(d.id_producto)) || 0) + validarCantidad(d.cantidad));
  }
  const productos = await db.producto.findAll({ where: { id_producto: [...cantidades.keys()], activo: true }, attributes: ["id_producto", "precio_unitario"] });
  if (productos.length !== cantidades.size) throw errorHttp(400, "Alguna prenda no existe o ya no está a la venta.");
  const subtotal = r2(productos.reduce((s, p) => s + Number(p.precio_unitario) * cantidades.get(p.id_producto), 0));

  let descuento = 0, cuponInfo = null, cupon_error = null;
  if (typeof cupon === "string" && cupon.trim()) {
    const ev = await evaluarCupon(cupon, { lineas: subtotal, id_sucursal });
    if (ev.error) cupon_error = ev.error;
    else { descuento = ev.descuento; cuponInfo = { codigo: ev.cupon.codigo, descripcion: ev.cupon.descripcion }; }
  }
  const costo_envio = envio ? costoEnvio(subtotal - descuento, envio) : 0;
  const total = r2(Math.max(0, subtotal - descuento) + costo_envio);
  return { subtotal, descuento, costo_envio, total, ...desgloseIva(total), cupon: cuponInfo, cupon_error, codigo: cupon ? normalizarCodigo(cupon) : null };
}

module.exports = { cotizar };
