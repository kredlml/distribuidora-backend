import { api } from "./api";

export const listar = () => api("/api/categorias");
export const crear = (body) => api("/api/categorias", { method: "POST", body });
export const actualizar = (id, body) => api(`/api/categorias/${id}`, { method: "PUT", body });
export const eliminar = (id) => api(`/api/categorias/${id}`, { method: "DELETE" });
