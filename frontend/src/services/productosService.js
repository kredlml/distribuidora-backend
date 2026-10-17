import { api } from "./api";

export const listar = () => api("/api/productos");
export const historial = (id) => api(`/api/productos/${encodeURIComponent(id)}/historial`);
export const crear = (body) => api("/api/productos", { method: "POST", body });
export const actualizar = (id, body) => api(`/api/productos/${id}`, { method: "PUT", body });
export const eliminar = (id) => api(`/api/productos/${id}`, { method: "DELETE" });
