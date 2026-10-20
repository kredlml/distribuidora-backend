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

export const PUESTOS = [["ADMIN", "Administrador"], ["CAJERO", "Cajero"], ["BODEGUERO", "Bodeguero"]];

export const ACCION = {
  aprobar: { boton: "Aprobar", titulo: "Aprobar devolución", texto: "La solicitud pasará a Aprobada y podrá recibirse en bodega.", obs: true, ok: "aprobada" },
  rechazar: { boton: "Rechazar", titulo: "Rechazar devolución", texto: "La solicitud se cierra y sus prendas dejan de contar como devueltas.", obs: true, ok: "rechazada" },
  recibir: { boton: "Marcar como recibida", titulo: "Recibir prendas", texto: "Confirma que las prendas llegaron físicamente a la sucursal.", obs: true, ok: "recibida" },
  revisar: { boton: "Registrar inspección", titulo: "Inspección de prendas", texto: "Indica el estado de cada prenda y si la devolución se acepta.", obs: true, ok: "inspeccionada" },
  reintegrar: { boton: "Reintegrar a inventario", titulo: "Reintegrar a inventario", texto: "Cada prenda vuelve al inventario según el resultado de su inspección.", obs: false, ok: "reintegrada a inventario" },
  cambiar: { boton: "Procesar cambio", titulo: "Procesar cambio", texto: "Se descuenta la prenda nueva del inventario y se reingresa la devuelta.", obs: false, ok: "cambio procesado" },
};
