const db = require("../models");
const { errorHttp } = require("./facturacion");
const { descuentoDeCupon } = require("./precios");

// Validación y uso de cupones de descuento.
const ZONA = process.env.ZONA_HORARIA_NOMBRE || "America/Guatemala";
const hoyGT = () => new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date()); // AAAA-MM-DD
const CODIGO_RE = /^[A-Z0-9_-]{3,30}$/;
const normalizarCodigo = (c) => String(c || "").trim().toUpperCase();

// Motivo por el que un cupón no aplica (null si aplica). `lineas`: suma de prendas. Para no revelar
// qué códigos existen, inexistente, inactivo, futuro, vencido, agotado o de otra sucursal reciben
// el mismo mensaje; solo la compra mínima se explica (el cupón es válido y la clienta puede cumplirla).
const NO_VALIDO = "Ese cupón no es válido para esta compra.";
function motivoNoAplica(cupon, { lineas, id_sucursal }) {
  if (!cupon || !cupon.activo) return NO_VALIDO;
  const hoy = hoyGT();
  if (cupon.desde && hoy < cupon.desde) return NO_VALIDO;
  if (cupon.hasta && hoy > cupon.hasta) return NO_VALIDO;
  if (cupon.usos_maximos !== null && cupon.usos_maximos !== undefined && cupon.usos >= cupon.usos_maximos) return NO_VALIDO;
  if (cupon.id_sucursal && id_sucursal && Number(cupon.id_sucursal) !== Number(id_sucursal)) return NO_VALIDO;
  if (Number(lineas) < Number(cupon.minimo_compra || 0)) return `El cupón requiere una compra mínima de Q${Number(cupon.minimo_compra).toFixed(2)}.`;
  return null;
}

async function buscarCupon(codigo, opciones = {}) {
  const c = normalizarCodigo(codigo);
  if (!CODIGO_RE.test(c)) return null;
  return db.cupon.findOne({ where: { codigo: c }, ...opciones });
}

// Para cotizar (sin bloquear ni usar): { cupon, descuento } o { error }.
async function evaluarCupon(codigo, { lineas, id_sucursal }) {
  const cupon = await buscarCupon(codigo);
  const motivo = motivoNoAplica(cupon, { lineas, id_sucursal });
  if (motivo) return { error: motivo };
  return { cupon, descuento: descuentoDeCupon(cupon, lineas) };
}

// Al crear el pedido: bloquea el cupón (dos compras simultáneas no pasan el límite de usos), lo
// valida, suma un uso y lo asocia al pedido. Lanza 400 si no aplica.
async function usarCupon(pedido, codigo, lineas, t) {
  const cupon = await buscarCupon(codigo, { transaction: t, lock: t.LOCK.UPDATE });
  const motivo = motivoNoAplica(cupon, { lineas, id_sucursal: pedido.id_sucursal });
  if (motivo) throw errorHttp(400, motivo);
  await cupon.update({ usos: cupon.usos + 1 }, { transaction: t });
  // Copia de las condiciones del cupón: si después se edita, este pedido no cambia.
  Object.assign(pedido, { id_cupon: cupon.id_cupon, cupon_tipo: cupon.tipo, cupon_valor: cupon.valor, cupon_minimo: cupon.minimo_compra });
  await pedido.save({ transaction: t });
  return cupon;
}

// Al cancelar un pedido con cupón, el uso se devuelve.
async function liberarCupon(pedido, t) {
  if (!pedido.id_cupon) return;
  await db.cupon.update({ usos: db.sequelize.literal("GREATEST(usos - 1, 0)") }, { where: { id_cupon: pedido.id_cupon }, transaction: t });
}

module.exports = { normalizarCodigo, CODIGO_RE, motivoNoAplica, evaluarCupon, usarCupon, liberarCupon, hoyGT };
