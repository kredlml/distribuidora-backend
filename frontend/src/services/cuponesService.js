import { api } from "./api";

export const listar = () => api("/api/cupones");
export const crear = (body) => api("/api/cupones", { method: "POST", body });
export const actualizar = (id, body) => api(`/api/cupones/${id}`, { method: "PUT", body });
export const eliminar = (id) => api(`/api/cupones/${id}`, { method: "DELETE" });
