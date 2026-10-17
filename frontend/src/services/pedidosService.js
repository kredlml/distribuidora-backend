import { api } from "./api";

export const listarEntregados = (idCliente) => api(`/api/pedidos?id_cliente=${idCliente}&estado=ENTREGADO`);
export const historial = (id) => api(`/api/pedidos/${encodeURIComponent(id)}/historial`);
