import { api } from "./api";

export const solicitar = (body) => api("/api/tienda/devoluciones", { method: "POST", body });
export const listar = () => api("/api/tienda/devoluciones");
export const obtener = (id) => api(`/api/tienda/devoluciones/${encodeURIComponent(id)}`);
