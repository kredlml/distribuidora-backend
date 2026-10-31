// Plazos configurables que comparten la API y los correos (para que nunca digan cosas distintas).

// Horas desde la entrega para pedir un cambio o una devolución (una sola solicitud por pedido).
const HORAS_PLAZO_DEVOLUCION = Number(process.env.HORAS_PLAZO_DEVOLUCION) > 0 ? Number(process.env.HORAS_PLAZO_DEVOLUCION) : 24;
const venceDevolucion = (pedido) => (pedido && pedido.fecha_entrega ? new Date(new Date(pedido.fecha_entrega).getTime() + HORAS_PLAZO_DEVOLUCION * 3600 * 1000) : null);

module.exports = { HORAS_PLAZO_DEVOLUCION, venceDevolucion };
