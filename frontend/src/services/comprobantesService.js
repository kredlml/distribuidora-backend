import { api } from "./api";

const qs = (filtros) => {
  const p = Object.entries(filtros || {}).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return p.length ? "?" + p.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&") : "";
};

/** filtros: { tipo: ENTRADA|SALIDA, concepto, id_sucursal, desde, hasta, q, id_pedido, id_devolucion, pagina } */
export const listar = (filtros) => api(`/api/comprobantes${qs(filtros)}`);
/** Comprobante completo: líneas, sucursal, responsable, proveedor, pedido y devolución. */
export const obtener = (id) => api(`/api/comprobantes/${encodeURIComponent(id)}`);
