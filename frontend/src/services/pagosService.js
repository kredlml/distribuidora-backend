import { api } from "./api";

/** { id_pedido, metodo_pago: EFECTIVO|TARJETA|PAYPAL, monto, referencia? } */
export const registrar = (body) => api("/api/pagos", { method: "POST", body });
export const confirmar = (id) => api(`/api/pagos/${id}/confirmar`, { method: "PUT" });
export const anular = (id) => api(`/api/pagos/${id}/anular`, { method: "PUT" });
/** Devuelve al cliente un cobro en efectivo o POS de un pedido que sigue pendiente. */
export const devolver = (id) => api(`/api/pagos/${id}/devolver`, { method: "PUT" });
