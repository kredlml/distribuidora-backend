import { api } from "./api";

export const listar = (filtros = {}) => {
  const p = new URLSearchParams();
  // Con `pagina` responde { datos, total, pagina, paginas }; `q` busca por número o clienta.
  ["estado", "tipo", "desde", "hasta", "q", "pagina"].forEach((k) => filtros[k] && p.set(k, filtros[k]));
  return api("/api/devoluciones?" + p);
};
export const obtener = (id) => api(`/api/devoluciones/${id}`);
export const historial = (id) => api(`/api/devoluciones/${id}/historial`);
export const crear = (body) => api("/api/devoluciones", { method: "POST", body });
export const ejecutarAccion = (id, accion, body) => api(`/api/devoluciones/${id}/${accion}`, { method: "PUT", body });
export const devolvible = (idPedido) => api(`/api/devoluciones/pedido/${idPedido}/devolvible`);
