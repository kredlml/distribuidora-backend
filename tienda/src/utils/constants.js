// Estados del pedido tal como los ve el cliente (máquina de estados del backend).
export const ESTADO_PEDIDO = {
  PENDIENTE: { texto: "Pendiente de pago", tono: "warn" },
  PROCESADO: { texto: "Pagado, en preparación", tono: "info" },
  ENVIADO: { texto: "En camino", tono: "info" },
  ENTREGADO: { texto: "Entregado", tono: "ok" },
  CANCELADO: { texto: "Cancelado", tono: "bad" },
};
export const PASOS_PEDIDO = ["PENDIENTE", "PROCESADO", "ENVIADO", "ENTREGADO"];
export const PASO_TEXTO = { PENDIENTE: "Pedido", PROCESADO: "Pagado", ENVIADO: "Enviado", ENTREGADO: "Entregado" };

export const ESTADO_DEVOLUCION = {
  SOLICITADA: { texto: "Solicitada", tono: "warn" },
  APROBADA: { texto: "Aprobada: envía o lleva la prenda", tono: "info" },
  RECHAZADA: { texto: "Rechazada", tono: "bad" },
  RECIBIDA: { texto: "Recibida en tienda", tono: "info" },
  EN_REVISION: { texto: "En revisión", tono: "info" },
  ACEPTADA: { texto: "Aceptada", tono: "info" },
  RECHAZADA_EN_REVISION: { texto: "Rechazada tras revisión", tono: "bad" },
  REINTEGRADA: { texto: "Devolución completada", tono: "ok" },
  CAMBIADA: { texto: "Cambio completado", tono: "ok" },
};

export const TIPOS_DEVOLUCION = [
  ["DEVOLUCION", "Devolver la prenda"],
  ["CAMBIO_TALLA", "Cambiar por otra talla"],
  ["CAMBIO_VARIANTE", "Cambiar por otro color o variante"],
];
export const MOTIVOS_DEVOLUCION = [
  ["TALLA_INCORRECTA", "La talla no me queda"],
  ["DEFECTUOSO", "Llegó con un defecto"],
  ["DANADO_ENVIO", "Se dañó en el envío"],
  ["PRODUCTO_INCORRECTO", "No es lo que pedí"],
  ["OTRO", "Otro motivo"],
];
export const RESULTADO_REVISION = { PENDIENTE: "Pendiente de revisión", BUEN_ESTADO: "En buen estado", DANADO: "Dañada", DEFECTUOSO: "Defectuosa" };
