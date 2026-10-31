import { api } from "./api";

/** filtros: { estado, id_pedido, id_devolucion } */
export const listar = (filtros = {}) => {
  const p = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  return api(`/api/reembolsos${p.toString() ? `?${p}` : ""}`);
};
/** Caja confirma que entregó el dinero (efectivo, POS o PayPal). */
export const completar = (id, referencia) => api(`/api/reembolsos/${id}/completar`, { method: "PUT", body: { referencia } });
/** Vuelve a pedir/consultar en Stripe un reembolso a tarjeta pendiente. */
export const reintentar = (id) => api(`/api/reembolsos/${id}/reintentar`, { method: "POST" });
