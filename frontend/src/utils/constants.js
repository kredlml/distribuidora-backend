export const ESTADOS = {
  SOLICITADA: "Solicitada", APROBADA: "Aprobada", RECHAZADA: "Rechazada", RECIBIDA: "Recibida",
  EN_REVISION: "En revisión", ACEPTADA: "Aceptada", RECHAZADA_EN_REVISION: "Rechazada en revisión",
  REINTEGRADA: "Reintegrada", CAMBIADA: "Cambiada",
};
export const TONO = { RECHAZADA: "bad", RECHAZADA_EN_REVISION: "bad", REINTEGRADA: "ok", CAMBIADA: "ok" };
export const CHIPS = ["", "SOLICITADA", "APROBADA", "RECIBIDA", "ACEPTADA", "REINTEGRADA", "CAMBIADA", "RECHAZADA", "RECHAZADA_EN_REVISION"];

export const TIPOS = ["DEVOLUCION", "CAMBIO_TALLA", "CAMBIO_VARIANTE"];
export const MOTIVOS = ["DEFECTUOSO", "TALLA_INCORRECTA", "PRODUCTO_INCORRECTO", "DANADO_ENVIO", "OTRO"];

export const INV_ESTADOS = ["DISPONIBLE", "DANADA", "DEFECTUOSA"];
export const INV_TONO = { DISPONIBLE: "ok", DANADA: "bad", DEFECTUOSA: "bad" };

// Motivos de una baja de stock (mismos códigos que inventario.controller).
export const MOTIVOS_AJUSTE = [
  ["CORRECCION_CONTEO", "Corrección por conteo físico"], ["PERDIDA", "Pérdida o extravío"], ["ROBO", "Robo"],
  ["DANO", "Daño en bodega"], ["DESCARTE", "Descarte de prenda dañada o defectuosa"], ["OTRO", "Otro motivo (explícalo)"],
];

export const ESTADOS_PEDIDO = {
  PENDIENTE: "Pendiente de pago", PROCESADO: "Pagado", ENVIADO: "Enviado", ENTREGADO: "Entregado", CANCELADO: "Cancelado",
};
export const TONO_PEDIDO = { ENTREGADO: "ok", CANCELADO: "bad" };
export const ORIGENES = [["TIENDA", "Tienda en línea"], ["MOSTRADOR", "Mostrador"]];
export const METODOS_PAGO = { EFECTIVO: "Efectivo", TARJETA: "Tarjeta (POS)", PAYPAL: "PayPal", STRIPE: "Tarjeta en línea" };
export const ESTADOS_PAGO = { PENDIENTE: "Por confirmar", COMPLETADO: "Completado", FALLIDO: "Anulado", REEMBOLSADO: "Devuelto" };
// Siguiente paso manual de cada estado (PROCESADO lo pone el sistema al cubrirse el pago).
export const SIGUIENTE_ESTADO = {
  PROCESADO: { estado: "ENVIADO", boton: "Marcar como enviado", texto: "El pedido salió de la sucursal hacia el cliente." },
  ENVIADO: { estado: "ENTREGADO", boton: "Marcar como entregado", texto: "El cliente recibió el pedido. Desde aquí puede pedir cambios o devoluciones." },
};

export const PUESTOS = [["DISTRITAL", "Gerente distrital"], ["ADMIN", "Administrador de sucursal"], ["CAJERO", "Cajero"], ["BODEGUERO", "Bodeguero"]];

export const ACCION = {
  aprobar: { boton: "Aprobar", titulo: "Aprobar devolución", texto: "La solicitud pasará a Aprobada y podrá recibirse en bodega.", obs: true, ok: "aprobada" },
  rechazar: { boton: "Rechazar", titulo: "Rechazar devolución", texto: "La solicitud se cierra de forma definitiva: el cliente ya no podrá pedir otro cambio ni devolución de este pedido (solo se permite una solicitud por pedido).", obs: true, ok: "rechazada" },
  recibir: { boton: "Marcar como recibida", titulo: "Recibir prendas", texto: "Confirma que las prendas llegaron físicamente a la sucursal.", obs: true, ok: "recibida" },
  revisar: { boton: "Registrar inspección", titulo: "Inspección de prendas", texto: "Indica el estado de cada prenda y si la devolución se acepta.", obs: true, ok: "inspeccionada" },
  reintegrar: { boton: "Reintegrar a inventario", titulo: "Reintegrar a inventario", texto: "Cada prenda vuelve al inventario según el resultado de su inspección.", obs: false, ok: "reintegrada a inventario" },
  cambiar: { boton: "Procesar cambio", titulo: "Procesar cambio", texto: "Se descuenta la prenda nueva del inventario y se reingresa la devuelta.", obs: false, ok: "cambio procesado" },
};
