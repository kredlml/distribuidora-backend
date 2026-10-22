import { api } from "./api";

export const listar = () => api("/api/proveedores");
export const crear = (body) => api("/api/proveedores", { method: "POST", body });
export const actualizar = (id, body) => api(`/api/proveedores/${id}`, { method: "PUT", body });
export const eliminar = (id) => api(`/api/proveedores/${id}`, { method: "DELETE" });
