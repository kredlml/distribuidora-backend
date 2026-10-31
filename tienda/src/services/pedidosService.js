import { api } from "./api";

const id = (x) => encodeURIComponent(x);

export const crear = (body) => api("/api/tienda/pedidos", { method: "POST", body });
/** { id_sucursal, detalles, cupon?, retiro_en_sucursal? } -> { subtotal, descuento, costo_envio, total, iva, cupon, cupon_error } */
export const cotizar = (body) => api("/api/tienda/cotizar", { method: "POST", body });
export const listar = () => api("/api/tienda/pedidos");
export const obtener = (idPedido) => api(`/api/tienda/pedidos/${id(idPedido)}`);
export const cancelar = (idPedido) => api(`/api/tienda/pedidos/${id(idPedido)}/cancelar`, { method: "POST" });
export const iniciarPago = (idPedido) => api(`/api/tienda/pedidos/${id(idPedido)}/pago`, { method: "POST" });
export const confirmarPago = (idPedido, idPago) => api(`/api/tienda/pedidos/${id(idPedido)}/pago/confirmar`, { method: "POST", body: idPago ? { id_pago: idPago } : {} });
export const devolvible = (idPedido) => api(`/api/tienda/pedidos/${id(idPedido)}/devolvible`);
