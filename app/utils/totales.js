// Recalcula el total de un pedido a partir de sus líneas, su cupón y su envío. Es la única fórmula
// del total (la usan los hooks de DetallePedido y la creación de pedidos):
//   total = max(0, suma de líneas − descuento del cupón) + costo de envío
//  - El descuento usa la COPIA del cupón guardada en el pedido (editar el cupón no cambia pedidos
//    ya creados).
//  - El envío se vuelve a calcular en pedidos de la tienda a domicilio (si caja agrega o quita
//    prendas puede pasar el umbral de envío gratis o dejar de pasarlo); sin prendas no hay envío.
// Recibe la instancia de Sequelize (no requiere ../models para no crear dependencias circulares
// con los hooks del modelo).
const { descuentoDeCupon, costoEnvio, r2 } = require("./precios");

async function recalcularPedido(sequelize, id_pedido, transaction) {
  const { Pedido, DetallePedido } = sequelize.models;
  const lineas = r2(Number(await DetallePedido.sum("subtotal", { where: { id_pedido }, transaction }) || 0));
  const pedido = await Pedido.findByPk(id_pedido, {
    attributes: ["id_pedido", "id_cupon", "cupon_tipo", "cupon_valor", "cupon_minimo", "costo_envio", "id_empleado", "direccion_entrega"], transaction
  });
  if (!pedido) return null;
  const cupon = pedido.id_cupon && pedido.cupon_tipo ? { tipo: pedido.cupon_tipo, valor: pedido.cupon_valor, minimo_compra: pedido.cupon_minimo } : null;
  const descuento = descuentoDeCupon(cupon, lineas);
  const aDomicilio = pedido.id_empleado === null && !!pedido.direccion_entrega;
  const envio = lineas <= 0 ? 0 : aDomicilio ? costoEnvio(lineas - descuento) : Number(pedido.costo_envio || 0);
  const total = r2(Math.max(0, lineas - descuento) + envio);
  await Pedido.update({ total, descuento, costo_envio: envio }, { where: { id_pedido }, transaction });
  return { lineas, descuento, costo_envio: r2(envio), total };
}

module.exports = { recalcularPedido };
