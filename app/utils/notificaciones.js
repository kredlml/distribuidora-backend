const db = require("../models");
const { enviar, TIENDA_URL } = require("./correo");
const { venceDevolucion } = require("./plazos");

// Avisos por correo a la clienta (si tiene correo). Se llaman DESPUÉS de confirmar la operación y
// nunca lanzan: si algo falla se registra en consola y la operación sigue intacta.
const dinero = (n) => `Q${Number(n || 0).toFixed(2)}`;
const fechaGT = (d) => new Date(d).toLocaleString("es-GT", { timeZone: "America/Guatemala", dateStyle: "long", timeStyle: "short" });
const seguro = (fn) => (...args) => { Promise.resolve().then(() => fn(...args)).catch((e) => console.warn(`[notificaciones] ${e.message}`)); };

async function pedidoConCliente(id) {
  return db.pedido.findByPk(id, { include: [{ model: db.cliente, attributes: ["nombre", "email", "activo"] }, { model: db.sucursal, attributes: ["nombre"] }] });
}
const enlacePedido = (p) => ({ texto: "Ver mi pedido", url: `${TIENDA_URL}/pedidos/${p.id_pedido}` });

// Cada aviso de pedido confirma que el pedido está de verdad en el estado que anuncia (si un
// COMMIT fallara después de programar el aviso, no se manda nada falso).
const enEstado = (p, estados) => p && estados.includes(p.estado) && p.Cliente && p.Cliente.email;

exports.pedidoPagado = seguro(async (id) => {
  const p = await pedidoConCliente(id);
  if (!enEstado(p, ["PROCESADO", "ENVIADO", "ENTREGADO"])) return;
  await enviar({
    para: p.Cliente.email, etiqueta: "pedido_pagado", asunto: `Recibimos el pago de tu pedido #${p.id_pedido}`,
    parrafos: [`Hola ${p.Cliente.nombre}, confirmamos el pago de ${dinero(p.total)} de tu pedido #${p.id_pedido}.`,
      p.direccion_entrega ? `Lo estamos preparando para enviarlo a: ${p.direccion_entrega}.` : `Lo estamos preparando en la sucursal ${p.Sucursal ? p.Sucursal.nombre : ""}.`],
    boton: enlacePedido(p)
  });
});

exports.pedidoEnviado = seguro(async (id) => {
  const p = await pedidoConCliente(id);
  if (!enEstado(p, ["ENVIADO", "ENTREGADO"])) return;
  const sucursal = p.Sucursal ? p.Sucursal.nombre : "";
  // Sin dirección de entrega (venta de mostrador) no "va en camino": está lista para recoger.
  await enviar(p.direccion_entrega ? {
    para: p.Cliente.email, etiqueta: "pedido_enviado", asunto: `Tu pedido #${p.id_pedido} va en camino`,
    parrafos: [`Hola ${p.Cliente.nombre}, tu pedido #${p.id_pedido} salió de la sucursal ${sucursal} hacia: ${p.direccion_entrega}.`], boton: enlacePedido(p)
  } : {
    para: p.Cliente.email, etiqueta: "pedido_enviado", asunto: `Tu pedido #${p.id_pedido} está listo para recoger`,
    parrafos: [`Hola ${p.Cliente.nombre}, tu pedido #${p.id_pedido} está listo en la sucursal ${sucursal}.`], boton: enlacePedido(p)
  });
});

exports.pedidoEntregado = seguro(async (id) => {
  const p = await pedidoConCliente(id);
  if (!enEstado(p, ["ENTREGADO"])) return;
  const vence = venceDevolucion(p);
  await enviar({
    para: p.Cliente.email, etiqueta: "pedido_entregado", asunto: `Tu pedido #${p.id_pedido} fue entregado`,
    parrafos: [`Hola ${p.Cliente.nombre}, registramos la entrega de tu pedido #${p.id_pedido}. ¡Gracias por tu compra!`,
      vence ? `Si algo no te quedó bien, puedes pedir un cambio o una devolución (una sola solicitud) hasta el ${fechaGT(vence)}.` : ""].filter(Boolean),
    boton: enlacePedido(p)
  });
});

exports.pedidoCancelado = seguro(async (id, motivo) => {
  const p = await pedidoConCliente(id);
  if (!enEstado(p, ["CANCELADO"])) return;
  await enviar({
    para: p.Cliente.email, etiqueta: "pedido_cancelado", asunto: `Tu pedido #${p.id_pedido} fue cancelado`,
    parrafos: [`Hola ${p.Cliente.nombre}, tu pedido #${p.id_pedido} fue cancelado${motivo ? ` ${motivo}` : ""}.`, "Las prendas volvieron a estar disponibles. Si aún las quieres, puedes hacer un pedido nuevo."],
    boton: { texto: "Ir a la tienda", url: TIENDA_URL }
  });
});

const TEXTO_DEVOLUCION = {
  SOLICITADA: "fue recibida. Te avisaremos por correo cada vez que avance.",
  APROBADA: "fue aprobada. Lleva o envía las prendas a la sucursal para revisarlas.",
  RECHAZADA: "no fue aprobada.",
  RECIBIDA: "llegó a la sucursal y la estamos revisando.",
  ACEPTADA: "pasó la revisión. Estamos terminando el proceso.",
  RECHAZADA_EN_REVISION: "no pasó la revisión de las prendas.",
  REINTEGRADA: "se completó: recibimos las prendas devueltas.",
  CAMBIADA: "se completó: tu cambio está listo."
};
// Asunto en palabras de la clienta (no los nombres internos de bodega).
const ASUNTO_DEVOLUCION = {
  SOLICITADA: "la recibimos", APROBADA: "fue aprobada", RECHAZADA: "no fue aprobada", RECIBIDA: "llegó a la sucursal",
  ACEPTADA: "pasó la revisión", RECHAZADA_EN_REVISION: "no pasó la revisión", REINTEGRADA: "devolución completada", CAMBIADA: "tu cambio está listo"
};
exports.devolucionActualizada = seguro(async (id) => {
  const d = await db.devolucion.findByPk(id, { include: [{ model: db.cliente, attributes: ["nombre", "email"] }] });
  if (!d || !d.Cliente || !d.Cliente.email || !TEXTO_DEVOLUCION[d.estado]) return;
  const tipo = d.tipo === "DEVOLUCION" ? "devolución" : "cambio";
  await enviar({
    para: d.Cliente.email, etiqueta: `devolucion_${d.estado.toLowerCase()}`, asunto: `Tu solicitud de ${tipo} #${d.id_devolucion}: ${ASUNTO_DEVOLUCION[d.estado]}`,
    parrafos: [`Hola ${d.Cliente.nombre}, tu solicitud de ${tipo} #${d.id_devolucion} ${TEXTO_DEVOLUCION[d.estado]}`],
    boton: { texto: "Ver mi solicitud", url: `${TIENDA_URL}/devoluciones/${d.id_devolucion}` }
  });
});

const reembolsoConCliente = (id) => db.reembolso.findByPk(id, { include: [{ model: db.pedido, include: [{ model: db.cliente, attributes: ["nombre", "email"] }, { model: db.sucursal, attributes: ["nombre"] }] }] });
const sucursalDe = (r) => (r.Pedido.Sucursal ? ` ${r.Pedido.Sucursal.nombre}` : "");

// Reembolso de caja listo: qué debe hacer la clienta depende de cómo pagó.
exports.reembolsoCreado = seguro(async (id) => {
  const r = await reembolsoConCliente(id);
  if (!r || r.estado !== "PENDIENTE" || !r.Pedido.Cliente || !r.Pedido.Cliente.email) return;
  const como = {
    STRIPE: "Lo estamos devolviendo a la tarjeta con la que pagaste; te avisaremos cuando se complete.",
    EFECTIVO: `Pasa por la sucursal${sucursalDe(r)} a recogerlo en caja (en efectivo).`,
    TARJETA: `Se revierte en la tarjeta con la que pagaste en la sucursal${sucursalDe(r)}; si caja te lo pide, acércate con tu tarjeta.`,
    PAYPAL: "Te lo devolveremos a tu cuenta de PayPal; no necesitas ir a la tienda."
  }[r.metodo];
  await enviar({
    para: r.Pedido.Cliente.email, etiqueta: r.metodo === "STRIPE" ? "reembolso_en_proceso" : "reembolso_en_caja", asunto: `Tu reembolso de ${dinero(r.monto)} está en proceso`,
    parrafos: [`Hola ${r.Pedido.Cliente.nombre}, aprobamos un reembolso de ${dinero(r.monto)} del pedido #${r.id_pedido}.`, como],
    boton: enlacePedido(r.Pedido)
  });
});

exports.reembolsoCompletado = seguro(async (id) => {
  const r = await reembolsoConCliente(id);
  if (!r || r.estado !== "COMPLETADO" || !r.Pedido.Cliente || !r.Pedido.Cliente.email) return;
  const como = {
    STRIPE: "Se devolvió a la tarjeta con la que pagaste; según tu banco puede tardar de 5 a 10 días hábiles en verse en tu estado de cuenta.",
    EFECTIVO: "Se te entregó en efectivo en la sucursal.",
    TARJETA: "Se revirtió en la tarjeta con la que pagaste en la sucursal; según tu banco puede tardar unos días en verse.",
    PAYPAL: "Se devolvió a tu cuenta de PayPal."
  }[r.metodo];
  await enviar({
    para: r.Pedido.Cliente.email, etiqueta: "reembolso_completado", asunto: `Te devolvimos ${dinero(r.monto)}`,
    parrafos: [`Hola ${r.Pedido.Cliente.nombre}, completamos el reembolso de ${dinero(r.monto)} del pedido #${r.id_pedido}.`, como],
    boton: enlacePedido(r.Pedido)
  });
});

// Stripe no pudo devolverlo a la tarjeta: se le entrega en efectivo en la sucursal.
exports.reembolsoFallido = seguro(async (id) => {
  const r = await reembolsoConCliente(id);
  if (!r || r.estado !== "FALLIDO" || !r.Pedido.Cliente || !r.Pedido.Cliente.email) return;
  await enviar({
    para: r.Pedido.Cliente.email, etiqueta: "reembolso_fallido", asunto: `Tu reembolso de ${dinero(r.monto)}: pásalo a recoger`,
    parrafos: [`Hola ${r.Pedido.Cliente.nombre}, no pudimos devolver ${dinero(r.monto)} del pedido #${r.id_pedido} a tu tarjeta.`,
      `Pasa por la sucursal${sucursalDe(r)} y te lo entregamos en efectivo en caja.`],
    boton: enlacePedido(r.Pedido)
  });
});

// Restablecer contraseña: se envía siempre al correo de la cuenta, con un enlace de un solo uso.
exports.restablecerPassword = seguro(async (cliente, token) => {
  const url = `${TIENDA_URL}/restablecer?correo=${encodeURIComponent(cliente.email)}&token=${encodeURIComponent(token)}`;
  await enviar({
    para: cliente.email, etiqueta: "restablecer_password", asunto: "Restablece tu contraseña",
    parrafos: [`Hola ${cliente.nombre}, recibimos una solicitud para restablecer la contraseña de tu cuenta.`, "El enlace sirve una sola vez y vence en 1 hora. Si no fuiste tú, ignora este correo: tu contraseña no cambia."],
    boton: { texto: "Crear una contraseña nueva", url }
  });
});

exports.passwordCambiada = seguro(async (cliente) => {
  await enviar({
    para: cliente.email, etiqueta: "password_cambiada", asunto: "Tu contraseña cambió",
    parrafos: [`Hola ${cliente.nombre}, la contraseña de tu cuenta se cambió y se cerraron las sesiones abiertas.`, "Si no fuiste tú, restablécela de inmediato desde «¿Olvidaste tu contraseña?»."],
    boton: { texto: "Iniciar sesión", url: `${TIENDA_URL}/login` }
  });
});
