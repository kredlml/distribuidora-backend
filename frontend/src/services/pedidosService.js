import { api } from "./api";

const qs = (filtros) => {
  const p = Object.entries(filtros || {}).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return p.length ? "?" + p.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&") : "";
};

/** filtros: { estado, id_cliente, id_sucursal, origen: TIENDA|MOSTRADOR, desde, hasta } */
export const listar = (filtros) => api(`/api/pedidos${qs(filtros)}`);
export const listarEntregados = (idCliente) => api(`/api/pedidos?id_cliente=${idCliente}&estado=ENTREGADO`);
export const obtener = (id) => api(`/api/pedidos/${encodeURIComponent(id)}`);
export const historial = (id) => api(`/api/pedidos/${encodeURIComponent(id)}/historial`);
/** Venta de mostrador: { id_cliente, id_sucursal, detalles: [{ id_producto, cantidad }] } */
export const crear = (body) => api("/api/pedidos", { method: "POST", body });
export const cambiarEstado = (id, estado) => api(`/api/pedidos/${id}/estado`, { method: "PUT", body: { estado } });
// Líneas de un pedido PENDIENTE (los hooks de DetallePedido recalculan el total).
export const agregarLinea = (id_pedido, id_producto, cantidad) => api("/api/detalles", { method: "POST", body: { id_pedido, id_producto, cantidad } });
export const quitarLinea = (idDetalle) => api(`/api/detalles/${idDetalle}`, { method: "DELETE" });
